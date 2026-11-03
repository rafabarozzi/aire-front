/** Local import only: never log or persist the selected private key in the browser. */
export function importedPem(name: string, content: string) {
  const value = content.trim();
  if (!name.toLowerCase().endsWith(".pem") || content.length > 8192 ||
    !/^-----BEGIN (RSA )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END \1PRIVATE KEY-----$/.test(value)) {
    throw new Error("Selecione uma chave privada .pem válida de até 8 KB.");
  }
  return value;
}
