# Krabice malých dárků

Webová aplikace na plochu telefonu. Každé pondělí o půlnoci českého času v ní „dorazí“ nový dopis, vzpomínka, pozvánka nebo jiný malý dárek – celkem 52 týdnů od 16. 11. 2026.

## Jak to funguje

- **Aplikace** (`public/`) – krabice s obálkou, čtení dopisu, kalendář, wishlist.
- **Stránka pro vkládání** (`/admin/`) – obsah týdnů, PIN, e-maily, odezvy, zkoušení.
- **Server** (`src/`) – Cloudflare Worker. Vydá dopis až po půlnoci a po zadání PINu, ukládá reakce, posílá upozornění a nedělní souhrn.
- Obsah dopisů a fotky nejsou v tomto repozitáři. Ukládají se do databáze (D1) a úložiště (KV) na Cloudflare.

## Nasazení

1. V Cloudflare: **Workers & Pages → Create → Import a repository** a vybrat tento repozitář.
2. Deploy command nechat `npx wrangler deploy`. Databáze i úložiště se při prvním nasazení vytvoří samy.
3. Otevřít `https://…workers.dev/admin/`, nastavit heslo, PIN a e-maily.

Každý další push do větve `main` se nasadí sám.

## Pravidla krabice

- Dopis se odemkne v pondělí v 0:00 (Europe/Prague).
- Od pátku doutná (po otevření je očouzený), s příchodem dalšího dopisu shoří.
- Shořelý dopis vzkřísí živá voda (na začátku 1, další za každých 5 dopisů otevřených včas po sobě, nejvýš 3) nebo správkyně na stránce pro vkládání.
- Počasí na pozadí: listopad Paříž, prosinec–leden Rotterdam, únor–duben Vídeň, jinak New York.

## Místní spuštění

```bash
npm install
```

```bash
npm run dev
```
