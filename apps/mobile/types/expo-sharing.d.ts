// Minimal ambient declaration for expo-sharing.
// The real types ship with the package; this shim exists so the workspace
// typechecks even when node_modules have not been installed locally.
declare module 'expo-sharing' {
  export interface SharingOptions {
    mimeType?: string;
    dialogTitle?: string;
    UTI?: string;
  }
  export function isAvailableAsync(): Promise<boolean>;
  export function shareAsync(url: string, options?: SharingOptions): Promise<void>;
}
