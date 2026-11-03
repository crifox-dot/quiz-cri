# Quiz HIV con codici monouso

Sito su **GitHub Pages**, backend su **Cloudflare Workers + KV**. Tutto gratuito.
Il sito non usa servizi esterni: font di sistema e QR code generato nella pagina.

## Le tre pagine
| Pagina | Chi la usa | Password |
|---|---|---|
| `index.html` | il pubblico: fa il quiz e riceve il codice con il QR | nessuna |
| `admin.html` | il Comitato: convalida i codici scansionando il QR | `ADMIN_PASSWORD` |
| `domande.html` | chi può modificare le domande del quiz | `EDITOR_PASSWORD` (diversa dalla precedente) |

`domande.html` non è collegata da nessuna parte: si raggiunge solo conoscendo l'indirizzo
(`https://IL-TUO-UTENTE.github.io/NOME-REPO/domande.html`).

## File da caricare su GitHub (repository pubblico)
`index.html`, `admin.html`, `domande.html`, `style.css`, `logo.png`, `qrcode.js`

**NON caricare `worker.js` su GitHub**: contiene le risposte del quiz iniziale. Va solo su Cloudflare.
Pagine e `worker.js` vanno aggiornati INSIEME (prima Cloudflare, poi GitHub, a pochi minuti di distanza).

## Cloudflare: aggiornare il Worker e aggiungere la password dell'editor
1. Workers & Pages → il tuo Worker → **Edit code** → seleziona tutto, incolla `worker.js` → **Deploy**.
2. **Settings → Variables and Secrets → Add** → tipo **Secret**, nome `EDITOR_PASSWORD`, valore = la nuova password
   (DEVE essere diversa da `ADMIN_PASSWORD`, altrimenti l'editor rifiuta l'accesso). Salva e fai Deploy.
3. Binding `CODES` e secret `ADMIN_PASSWORD` restano quelli già impostati.

## Come funziona l'editor
- Le domande in uso stanno in KV (chiave `config:quiz`). Il quiz iniziale scritto in `worker.js` (`DEFAULT_QUIZ`)
  vale solo finché nessuno pubblica: dopo la prima pubblicazione, cambiare `DEFAULT_QUIZ` non modifica il quiz online.
- Le modifiche sono una bozza nella pagina finché non si preme **Pubblica**.
- Controlli prima di pubblicare: testo non vuoto, da 2 a 6 risposte diverse, una sola giusta, soglia tra 1 e il numero di domande, massimo 50 domande.
- Chi sta facendo il quiz mentre si pubblica riparte da capo con le domande nuove (avviso a schermo).
- Se due persone modificano insieme, la seconda a pubblicare riceve un avviso e non sovrascrive.
- I codici già emessi restano validi.
- Le modifiche possono impiegare fino a circa un minuto a raggiungere tutti (KV è distribuito).
- Per tornare al quiz iniziale: Cloudflare → Storage & databases → Workers KV → CODES → elimina la voce `config:quiz`.
- Non c'è cronologia delle versioni: copia le domande da qualche parte prima di cambiamenti importanti.

## Come si usa alla scansione del QR
- **Telefono del Comitato** (collegato una volta con la password, resta collegato 12 ore): scansionando il QR il codice viene convalidato subito e segnato come usato.
- **Qualunque altro telefono** (senza password): vede solo lo stato del codice, senza consumarlo.
- Il pulsante **Esci** scollega subito il telefono (consigliato a fine evento).

## Limiti di tentativi (in cima a worker.js)
- Password admin o editor: 5 errori → accesso bloccato 15 minuti per quell'indirizzo IP (`LOGIN_MAX_FAILS`, `LOGIN_LOCK_SEC`); i contatori admin ed editor sono separati
- Quiz: 20 invii all'ora per indirizzo IP (`SUBMIT_MAX`, `SUBMIT_WINDOW_SEC`)
- Durata del collegamento: `SESSION_SEC` (12 ore)
- Il piano gratuito di KV consente circa 1000 scritture al giorno: ogni invio ne usa una o due, ogni convalida una, ogni pubblicazione una.

## Note
- Usa password lunghe (12 caratteri o più) e diverse tra loro.
- Il codice è monouso: la prima convalida lo segna come usato.
