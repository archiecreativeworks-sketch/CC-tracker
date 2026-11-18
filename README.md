# BPI Credit Card Tracker

A simple personal expense tracker for our BPI credit card. It is a static web app (plain HTML/CSS/JS): no install, no server, no account. Data is saved in your browser's localStorage.

## Run it
- **Locally:** open `index.html` in a browser.
- **On your phone:** enable GitHub Pages for this repo (Settings → Pages → Deploy from branch), open the URL, then "Add to Home Screen".

## Features
- **Statement cycles** based on your BPI cut-off day: every transaction is grouped into the statement it will appear on, with the payment due date.
- **Overview:** charges per statement, due date countdown, outstanding balance, available credit vs. your limit, breakdowns by category and cardholder (principal and supplementary), and a 6-statement trend.
- **Transactions:** purchases, payments, refunds and fees/interest, with search and filters.
- **Installments** (BPI Real 0% / SIP): monthly amortization is added to each statement until paid off, with progress and remaining balance.
- **Backup:** export/import JSON, export CSV, and import CSV (`date,description,amount,category,cardholder,type,notes`).

## First-time setup
Open **Settings** and enter your credit limit, last 4 digits, statement cut-off day (printed on your BPI statement), days until the due date, cardholder names and categories.

> Data stays only in the browser where you enter it. Export a backup regularly; use Import to move it to another device.
