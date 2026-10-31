# Implantação no Ubuntu 24.04 LTS

O repositório entrega os arquivos de implantação. A VM, DNS, TLS e provedores de identidade ainda precisam ser configurados. Não publique a demonstração como se fosse o ambiente de clientes.

## Docker Compose

1. Instale Docker Engine e Compose pela documentação oficial para Ubuntu: https://docs.docker.com/engine/install/ubuntu/ .
2. Configure o registro DNS `A` de `aire.northeia.com` para o IP público da VM. Configure `AAAA` somente se IPv6 estiver operacional. Reserve as portas TCP 80 e 443 para Caddy e mantenha a 3000 inacessível externamente.
3. Clone este repositório. Copie `.env.example` para `.env.production`, execute `chmod 600 .env.production` e preencha os valores localmente.
4. Gere `AIRE_SESSION_SECRET` com `openssl rand -hex 32`. Configure os clientes OAuth e os vínculos conforme `identity.md`. Use um JSON em uma única linha em `AIRE_TENANTS_JSON`.
5. Configure `NORTHEIA_ENGINE_URL` com um endereço acessível de dentro do container. `127.0.0.1` no front aponta para o próprio container. Prefira uma rede Docker compartilhada com o motor ou um endereço privado da VM; nunca exponha o motor publicamente para contornar a rede.
6. Informe `ACME_EMAIL` e mantenha `AIRE_DOMAIN=aire.northeia.com`, ou ajuste domínio e callbacks juntos.

```sh
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
curl --fail https://aire.northeia.com/healthz
```

Caddy solicita o certificado quando o DNS e as portas estão disponíveis. O endpoint de saúde testa apenas o processo do front, não valida GitHub, SSO nem motor. O front usa uma réplica e persistência em `aire-data`; preserve esse volume em atualizações. Faça backup criptografado do volume e das configurações. Não inclua os segredos na imagem.

Atualização:

```sh
git pull --ff-only
docker compose --env-file .env.production up -d --build
```

Rollback: use a versão anterior do código/imagem e o mesmo volume, respeitando futuras migrações. Não rode `down -v` em produção.

## k3s

O manifesto usa uma réplica e estratégia Recreate porque os metadados são locais. Para alta disponibilidade será necessário substituir o armazenamento por um banco transacional compartilhado e implementar coordenação distribuída.

1. Construa a imagem na VM: `docker build -t aire-front:0.1.0 .`.
2. Importe no containerd do k3s, ou use um registry privado com tag/digest fixado. Exemplo de importação local: `docker save aire-front:0.1.0 | sudo k3s ctr images import -`.
3. Crie o namespace `aire` e o Secret `aire-front-config` com as variáveis de `.env.production`. O arquivo não deve ser versionado.

```sh
kubectl create namespace aire --dry-run=client -o yaml | kubectl apply -f -
kubectl -n aire create secret generic aire-front-config \
  --from-env-file=.env.production --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f deploy/k3s/aire-front.yaml
kubectl -n aire rollout status deployment/aire-front
```

4. Antes de abrir o acesso público, disponibilize um certificado válido no Secret `aire-front-tls` (por exemplo com cert-manager/ACME já instalado). O manifesto não instala cert-manager nem cria um emissor. O Ingress usa `websecure`, classe `traefik` e o domínio sugerido; ajuste-os à configuração do cluster.
5. Confirme PVC, leitura/escrita em `/data`, HTTPS, callbacks de login e alcance privado do motor. Defina políticas de rede conforme os destinos do seu cluster; o BFF precisa acessar DNS, provedores OIDC, GitHub/codeload e o motor.

## Aceitação da implantação

- Saúde responde sem expor configuração ou segredos.
- Login Google e Microsoft redireciona apenas para o domínio configurado.
- Usuário sem vínculo não acessa análises; usuário de outra organização recebe 404 para IDs alheios.
- Leitor não consegue criar jornadas nem editar permissões; mudanças de RBAC valem na próxima requisição.
- Um repositório autorizado e um bloqueado produzem resultados coerentes.
- Análise real percorre o motor e, quando necessário, o n8n até gerar o manifesto.
- Reiniciar o front preserva os metadados e permissões.

A prévia Sites usa `AIRE_MODE=demo` e não é o armazenamento de produção. O build da Contabo usa Next.js standalone e arquivos persistentes.
