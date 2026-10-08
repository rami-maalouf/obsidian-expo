/**
 * restores vault access on launch and lets the user pick a folder (r1, flow f2).
 */
import { useCallback, useEffect, useState } from 'react';

import { VaultNative } from '../../../modules/vault/src';
import { LAST_VAULT_KEY, launchVault, type VaultInfo } from './launch';

export type { VaultInfo };


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

  /** `remember` false skips recording the vault as the last one, when it already is. */
  const open = useCallback(async (vault: VaultInfo, remember = true) => {
    if (!VaultNative) return;
    try {
      await VaultNative.openVault(vault.id);
      setState({ phase: 'ready', vault });
      if (remember) VaultNative.writeAppData(LAST_VAULT_KEY, vault.id).catch(() => undefined);
    } catch (error) {
      setState({ phase: 'unavailable', vault, error: message(error) });
    }
  }, []);

  useEffect(() => {
    if (!VaultNative) return;
    let cancelled = false;
    const native = VaultNative;
    Promise.all([native.listVaults(), native.readAppData(LAST_VAULT_KEY).catch(() => null)]).then(
      ([vaults, lastId]) => {
        if (cancelled) return;
        const vault = launchVault(vaults, lastId);
        if (vault) {
          open(vault, vault.id !== lastId);
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
