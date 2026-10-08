import { requireOptionalNativeModule } from 'expo';

/** the native vault module. it exists only in ios builds; web and expo go return null. */
export type VaultNativeModule = {
  readonly coreVersion: string;
  /** returns null for a valid vault-relative path, or the reason it is refused. */
  checkRelativePath(path: string): string | null;
};

export const VaultNative = requireOptionalNativeModule<VaultNativeModule>('Vault');
