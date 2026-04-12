# @oni.bot/hot-loader

File-watching extension loader for `DynamicToolRegistry` from
[@oni.bot/core](https://www.npmjs.com/package/@oni.bot/core).

Drop a `.ts`/`.js`/`.mjs` file into a watched directory — its exported
functions become registered tools. Change the file, the tools hot-swap.
Delete the file, the tools unregister.

## Install

```bash
npm install @oni.bot/hot-loader chokidar
```

`chokidar` is a peer dependency.

## Usage

```typescript
import { DynamicToolRegistry } from "@oni.bot/core/registry";
import { watchExtensions } from "@oni.bot/hot-loader";

const registry = new DynamicToolRegistry();

const loader = watchExtensions({
  dir: "/path/to/extensions",
  registry,
  onLoad: (file, tools) => console.log(`loaded ${tools.join(", ")} from ${file}`),
  onUnload: (file, tools) => console.log(`unloaded ${tools.join(", ")} from ${file}`),
  onError: (file, err) => console.error(`failed to load ${file}:`, err),
});

// ... later ...
loader.stop();
```

## Extension file contract

Each exported function becomes a tool. Attach a `.schema` property for
metadata.

```typescript
import type { ToolHandler } from "@oni.bot/core/registry";

export const search_web: ToolHandler = async (args, state) => {
  const results = await fetchResults(args.query as string);
  return {
    tool_name: "search_web",
    success: true,
    output: JSON.stringify(results),
  };
};

search_web.schema = {
  name: "search_web",
  description: "Search the web for current information",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};
```

## API

### `watchExtensions(options): HotLoader`

**Options:**
- `dir` — absolute path to watch
- `registry` — your `DynamicToolRegistry` instance
- `pattern?` — glob-style extension filter (default `**/*.{ts,js,mjs}`)
- `onLoad?(file, tools)`
- `onUnload?(file, tools)`
- `onError?(file, error)`

**Returns:**
- `stop()` — stop watching
- `loaded()` — `Map<filePath, toolNames[]>` of currently loaded tools

## License

MIT
