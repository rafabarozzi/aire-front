/** Move complete Mermaid blocks to the map, preserving the rest of the report. */
export function splitJourneyReport(source: string) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const body: string[] = [],
    diagrams: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const opening = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(lines[i]);
    if (!opening) {
      body.push(lines[i]);
      continue;
    }
    const close = new RegExp(
      `^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`,
    );
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end++;
    if (end === lines.length || opening[2].trim().toLowerCase() !== "mermaid") {
      body.push(...lines.slice(i, Math.min(end + 1, lines.length)));
    } else {
      diagrams.push(lines.slice(i + 1, end).join("\n"));
      const last = body.findLastIndex((line) => line.trim() !== "");
      if (
        last >= 0 &&
        /^#{1,6}\s+(?:\d+\s*[-–]\s*)?Macro\s*fluxo\b/i.test(body[last])
      )
        body.splice(last);
    }
    i = end;
  }
  return { diagrams, markdown: body.join("\n").trim() };
}

export function assertSafeFlowchart(source: string) {
  if (
    source.length > 200_000 ||
    !/^\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/.test(source) ||
    /%%\{|^\s*click\s|url\s*\(|@import|<\s*(script|iframe|img|image|object)\b/im.test(
      source,
    )
  ) {
    throw new Error(
      "Formato do diagrama indisponível para visualização segura.",
    );
  }
  return source;
}
