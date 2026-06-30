# /data — DLD/DLS Book Folder

Place your Digital Logic Design (DLD) or Digital Logic Studio (DLS) books here.

## Supported formats
- `.pdf` — PDF textbooks
- `.txt` — Plain text files

## How to ingest

After adding your books, run:

```bash
node scripts/ingest.js
```

This will chunk the books and upload them to Pinecone.
The chatbot will then answer questions based on your curriculum content.

## Suggested books
- Morris Mano — Digital Design
- Floyd — Digital Fundamentals
- Tocci — Digital Systems
- Any DLS course notes or slides (exported as PDF/text)

## Notes
- Do NOT commit actual book PDFs to git (copyright). They are gitignored.
- You can re-run the ingestion script any time you add new books.
