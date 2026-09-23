# CS ARENA

Site em português para organizar partidas de Counter-Strike entre amigos. Visual militar inspirado na direção de arte de Call of Duty, com identidade própria e imagem original gerada por IA.

## Iniciar

Requer Node.js 24 ou superior. Para a versão Node local não há dependências de execução; para testes e Cloudflare, instale as ferramentas com `npm ci`.

```powershell
npm start
```

Abra http://localhost:3000. Na primeira execução, o terminal mostra a senha inicial do organizador. Guarde-a e use **Área do organizador** para cadastrar e editar. Visitantes acompanham os dados sem login.

Para escolher a senha antes da primeira execução:

```powershell
$env:ADMIN_PASSWORD = 'sua-senha-forte'
npm start
```

A variável só configura a senha ao criar o banco pela primeira vez. As credenciais são persistidas como hash com salt em `data/admin.json`. Se perder a senha, pare o servidor, faça uma cópia desse arquivo, renomeie-o e reinicie com `ADMIN_PASSWORD` definida; os resultados em `arena.sqlite` são preservados.

## Usar com a galera

O site começa vazio, sem times, jogadores, partidas ou estatísticas de demonstração.

1. Entre como organizador usando a senha criada na primeira execução.
2. Em **Times & jogadores**, crie os times e seus jogadores.
3. Em **Partidas**, agende confrontos ou registre partidas finalizadas.
4. Preencha placar, kills, mortes e assistências. Os rankings são recalculados automaticamente.
5. Compartilhe a senha apenas com quem deve organizar e editar as partidas.

Vitória vale 3 pontos e empate vale 1. Os times empatados são ordenados por saldo de rounds e vitórias; persistindo o empate, por nome. Jogadores são ordenados por kills, menos mortes e nome. K/D é a razão entre totais; sem mortes e com kills aparece ∞. Partidas agendadas não contam no ranking. Datas e horários são tratados como horário local da comunidade, sem conversão de fuso.

O banco é compartilhado no servidor, não no armazenamento do navegador. Em uma mesma rede, os amigos podem acessar `http://IP-DO-COMPUTADOR:3000` se a rede e o firewall permitirem. Para acesso pela internet, use a configuração Cloudflare abaixo.

## Publicar na Cloudflare (Workers + D1)

A versão online usa `worker/index.js`, o banco persistente D1 e os arquivos estáticos de `public/`. A versão local Node continua disponível com `npm start`. A configuração ativa está em `wrangler.jsonc`.

```powershell
npm ci
npx wrangler login
npx wrangler d1 create cs-arena-db
```

Copie o `database_id` retornado pela Cloudflare para a entrada `d1_databases` em `wrangler.jsonc`. Se o Wrangler já tiver incluído o campo, não crie outro banco. Se a conta tiver vários bancos com esse nome, identifique o correto antes de prosseguir. Depois:

```powershell
npm run db:remote
npm run secret:cloudflare
npm test
npm run deploy
```

O script `secret:cloudflare` gera uma senha aleatória, salva em `data/cloudflare-admin-password.txt` (ignorado pelo Git) e a envia como secret `ADMIN_PASSWORD` à Cloudflare. Abra esse arquivo para consultar a senha. Ela nunca é enviada ao GitHub. O script reutiliza o arquivo se ele já existir. Também é possível definir uma senha própria de 16 a 200 caracteres com `npx wrangler secret put ADMIN_PASSWORD`.

Use a URL HTTPS `.workers.dev` retornada pelo deploy para compartilhar com os amigos. Não é necessário comprar domínio. O banco online começa vazio; o SQLite local não é enviado. Sessões duram 24 horas e sobrevivem a atualizações do Worker. Trocar o secret invalida todas as sessões anteriores.

Escolha Workers Free na sua conta. O projeto não requer recursos pagos. Os limites gratuitos da plataforma e da conta se aplicam; ultrapassá-los pode interromper o acesso até a renovação da cota. A versão atual armazena o histórico em um documento de até 1,5 MB no D1 (limite da aplicação, inferior à capacidade total do plano). Quando esse volume for atingido, a API recusa novos salvamentos sem apagar dados; o armazenamento poderá ser dividido em tabelas por partida numa evolução futura. Escritas simultâneas usam controle de versão para evitar perda de cadastros.

Para atualizar: execute `npm test`, depois `npm run db:remote` se houver migrações novas e `npm run deploy`. Enviar um commit ao GitHub, sozinho, não publica uma atualização na Cloudflare.

### Testar Workers no computador

Crie `.dev.vars` na raiz com `ADMIN_PASSWORD="uma-senha-local-com-16-caracteres"` (use uma senha de teste, não a de produção). Esse arquivo não vai para o Git. Execute:

```powershell
npm run db:local
npm run dev:cloudflare
```

O endereço local aparece no terminal. As migrações locais não alteram o banco online. `npm run deploy:check` verifica o pacote sem publicá-lo.

Documentação: [Workers](https://developers.cloudflare.com/workers/), [D1](https://developers.cloudflare.com/d1/), [limites gratuitos](https://developers.cloudflare.com/workers/platform/pricing/).

## Dados e testes

O SQLite fica em `data/arena.sqlite`; para backup completo, pare o servidor e copie a pasta `data`. O botão **Exportar dados** baixa uma cópia JSON para consulta; restauração por upload não está implementada. Não disponibilize a pasta `data` publicamente.

```powershell
npm test
```

Os testes usam bancos temporários separados e o simulador oficial Miniflare. Validam autenticação, cookies, limite de tentativas, cadastros simultâneos, persistência após reinício, troca de senha, rankings e rejeição de dados inválidos. Nenhum teste altera o D1 remoto. No Node local, as sessões em memória expiram ao reiniciar; no Worker, as sessões são persistidas no D1.

## Arte

Imagem: `public/hero.png`. Gerada com a ferramenta integrada imagegen. Prompt utilizado: “Use case: stylized-concept. Asset: widescreen cinematic hero background for a Counter-Strike friends competitive league website. Two realistic fictional tactical counterterrorism operators with helmets, face coverings, tactical vests, carrying rifles pointed down, positioned on the RIGHT half of the frame. Sandy Mediterranean abandoned city courtyard, cinematic smoke and dust, warm muted golden light, charcoal shadows, subtle orange embers, film grain, premium AAA military game key art. LEFT half mostly dark atmospheric empty negative space for website typography. Wide 16:9 composition. No text, no logos, no watermarks. Save image for use in website.”

Referência de direção visual: https://www.callofduty.com/. Projeto independente, sem vínculo com Valve ou Activision.
