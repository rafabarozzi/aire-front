export function download(
  name: string,
  contents: string,
  type = "text/markdown",
) {
  const href = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
