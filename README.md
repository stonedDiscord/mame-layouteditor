# MAME Layout Editor

A browser-based editor for MAME `.lay` files, built with TypeScript and webpack.

## Development

```sh
npm install
npm run dev
```

The development server opens the editor at `http://localhost:8080` and reloads it when source files change. To run it without opening a browser, use `npm start`.

## Production build

```sh
npm run typecheck
npm run build
```

The deployable application is written to `dist/`. JavaScript filenames are content-hashed for long-term caching and source maps are emitted for debugging.
