# Tideline

A Next.js application featuring an interactive 3D scene built with [Three.js](https://threejs.org/).

## Tech Stack

- [Next.js](https://nextjs.org/) 14 (App Router)
- [React](https://react.dev/) 18
- [Three.js](https://threejs.org/)
- [TypeScript](https://www.typescriptlang.org/)

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the app.

## Scripts

| Command         | Description                       |
| --------------- | --------------------------------- |
| `npm run dev`   | Start the development server      |
| `npm run build` | Build the app for production      |
| `npm run start` | Run the production build          |
| `npm run lint`  | Lint the codebase                 |

## Project Structure

```
app/                 # Next.js App Router pages and layout
  layout.tsx         # Root layout
  page.tsx           # Home page
  globals.css        # Global styles
components/
  Tideline.tsx       # 3D scene component
```
