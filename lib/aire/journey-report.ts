export type ReportSection = {
  title: string;
  number: number | null;
  markdown: string;
  diagramIndexes: number[];
};

/** Extract complete diagrams without deleting their numbered report sections. */
export function splitJourneyReport(source: string) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const body: string[] = [],
    diagrams: string[] = [];
  const sections: ReportSection[] = [];
  let section: ReportSection = {
    title: "",
    number: null,
    markdown: "",
    diagramIndexes: [],
  };
  const append = (line: string) => {
    body.push(line);
    section.markdown += line + "\n";
  };
  const finish = () => {
    section.markdown = section.markdown.trim();
    if (section.title || section.markdown || section.diagramIndexes.length)
      sections.push(section);
  };
  for (let i = 0; i < lines.length; i++) {
    const heading = /^ {0,3}#\s+(.+?)\s*$/.exec(lines[i]);
    if (heading) {
      finish();
      heading[1] = heading[1].replace(/\s+#+$/, "");
      const number = /^(\d+)\s*[-–—.)]\s+/.exec(heading[1]);
      section = {
        title: heading[1],
        number: number ? Number(number[1]) : null,
        markdown: "",
        diagramIndexes: [],
      };
      body.push(lines[i]);
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(lines[i]);
    if (!opening) {
      append(lines[i]);
      continue;
    }
    const close = new RegExp(
      `^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`,
    );
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end++;
    if (end === lines.length || opening[2].trim().toLowerCase() !== "mermaid") {
      lines.slice(i, Math.min(end + 1, lines.length)).forEach(append);
    } else {
      section.diagramIndexes.push(diagrams.length);
      diagrams.push(lines.slice(i + 1, end).join("\n"));
    }
    i = end;
  }
  finish();
  return { diagrams, markdown: body.join("\n").trim(), sections };
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
