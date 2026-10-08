export type VaultInfo = { id: string; name: string };

/** app data key for the vault opened last, restored on the next launch. */
export const LAST_VAULT_KEY = 'app:last-vault';

/** the vault to open on launch: the last one used if it is still registered, else the newest. */
export function launchVault(vaults: VaultInfo[], lastId: string | null): VaultInfo | undefined {
  return vaults.find((vault) => vault.id === lastId) ?? vaults.at(-1);
}
