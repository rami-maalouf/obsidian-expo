/**
 * restores vault access on launch and lets the user pick a folder (r1, flow f2).
 */
import { useCallback, useEffect, useState } from 'react';

import { VaultNative } from '../../../modules/vault/src';

export type VaultInfo = { id: string; name: string };

export type VaultState =
  | { phase: 'unsupported' }
  | { phase: 'loading' }
  | { phase: 'needs-vault'; error?: string }
  /** the bookmark no longer works; the user must pick the folder again. */
  | { phase: 'unavailable'; vault: VaultInfo; error: string }
  | { phase: 'ready'; vault: VaultInfo };

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useVault() {
  const [state, setState] = useState<VaultState>(VaultNative ? { phase: 'loading' } : { phase: 'unsupported' });

  const open = useCallback(async (vault: VaultInfo) => {
    if (!VaultNative) return;
    try {
      await VaultNative.openVault(vault.id);
      setState({ phase: 'ready', vault });
    } catch (error) {
      setState({ phase: 'unavailable', vault, error: message(error) });
    }
  }, []);

  useEffect(() => {
    if (!VaultNative) return;
    let cancelled = false;
    VaultNative.listVaults().then(
      (vaults) => {
        if (cancelled) return;
        // the most recently added vault is the current one until vault switching exists (u5).
        const vault = vaults.at(-1);
        if (vault) {
          open(vault);
        } else {
          setState({ phase: 'needs-vault' });
        }
      },
      (error) => !cancelled && setState({ phase: 'needs-vault', error: message(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** cancelling the picker keeps the current state, including an open vault. */
  const choose = useCallback(async () => {
    if (!VaultNative) return;
    try {
      const picked = await VaultNative.pickVault();
      if (picked) {
        await open(picked);
      }
    } catch (error) {
      setState((current) => (current.phase === 'ready' ? current : { phase: 'needs-vault', error: message(error) }));
    }
  }, [open]);

  return { state, choose };
}
