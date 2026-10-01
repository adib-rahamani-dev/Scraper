// Legacy/direct download links remain phone-only. The panel explicitly sends 0
// when exporting the full visible work list, including not-yet-registered contacts.
export function exportPhoneOnly(value:unknown):boolean { return value!=='0'; }
