# tabby-user-manager

A [Tabby](https://github.com/Eugeny/tabby) plugin to store reusable SSH credentials (password, private key path, or agent) and apply them to multiple SSH profiles or profile groups at once.

## Features
- Create, edit and delete saved users
- Apply a user to selected SSH profiles or to whole profile groups
- Editing a user updates every profile linked to it

## Installation
Open Tabby → Settings → Plugins and search for `tabby-user-manager`.

## Security
- **Stored passwords** are encrypted with AES-256-GCM using a random key generated on first run (`users_db.key`, permissions `0600`, next to `users_db.json` in Tabby's config folder). Anyone who can read both files, or your user account, can decrypt them. This protects against casual disclosure (backups, screen shares, syncing only the database), not against a compromised account. Back up the key file together with the database, or the stored passwords become unreadable.
- **Applying a user to a profile writes the password to `config.yaml` in plain text** (the `password` field of each profile), whether or not Tabby's vault is enabled. This lets Tabby connect without asking for the vault passphrase each time. Anyone who can read that file, or a backup or sync of it, can read those passwords. **Strongly recommended:** enable Tabby's vault (Settings → Vault) and turn on config file encryption so `config.yaml` is encrypted at rest, and never commit or share the file. Prefer key or agent authentication where possible, since no secret is written to the config for those.
- **Private keys** are referenced by path and never copied. Passphrases are not stored by this plugin; Tabby asks for them on first connect.
- On Windows, file permissions (`0600`) are not enforced; protect your user profile folder accordingly.

Report vulnerabilities privately through GitHub Security Advisories on this repository.

## Upgrading from 1.1.x
On first start, existing users are migrated automatically to the new encryption format. A stored password that can't be recovered is shown as "unreadable" and must be re-entered. Profiles you applied before get corrected the next time you edit that user or re-apply it.

## Build and test
```
npm install
npm run build
npm test
```

## License
MIT
