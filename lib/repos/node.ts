// Client-safe: the Repos page compares pins in the browser.
export function parseToolVersions(content: string): string {
  return content.match(/^\s*node(?:js)?\s+(\S+)/m)?.[1] || "";
}

// Leading major number of a pin like "20", "v20.12.0", ">=18 <21", "20.x".
// Aliases ("lts/iron") have no digits and are not compared.
export function nodeMajor(version: string): number | null {
  const m = /(\d+)/.exec(version);
  return m ? Number(m[1]) : null;
}
