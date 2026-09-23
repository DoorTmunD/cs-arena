# CS ARENA

Site em português para organizar partidas de Counter-Strike entre amigos. Visual militar inspirado na direção de arte de Call of Duty, com identidade própria e imagem original gerada por IA.

## Iniciar

Requer Node.js 24 ou superior. Não há dependências para instalar.

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

O banco é compartilhado no servidor, não no armazenamento do navegador. Em uma mesma rede, os amigos podem acessar `http://IP-DO-COMPUTADOR:3000` se a rede e o firewall permitirem. Para acesso pela internet, use a configuração do Render abaixo.

## Publicar no Render

O arquivo `render.yaml` configura um serviço Node 24 com disco persistente de 1 GB, cookies seguros e verificação de saúde. Essa configuração usa recursos pagos: confira a estimativa no painel do Render antes de confirmar. O plano gratuito não suporta o disco necessário para preservar este SQLite.

1. Entre em https://dashboard.render.com/ e conecte sua conta do GitHub.
2. Autorize acesso ao repositório privado `DoorTmunD/cs-arena`.
3. Escolha **New → Blueprint**, selecione esse repositório e a branch `main`.
4. Defina `ADMIN_PASSWORD` com pelo menos 12 caracteres. Guarde essa senha; ela será usada no acesso do organizador e não será impressa nos logs.
5. Revise o custo do serviço e do disco e confirme a publicação se estiver de acordo.
6. Aguarde o serviço ficar **Live** e abra a URL HTTPS exibida pelo Render. O nome da URL será definido pela plataforma; não é garantido que seja `cs-arena.onrender.com`.

O site online começa vazio. O banco e as credenciais locais não são enviados ao Render. Novos commits em `main` disparam a execução dos testes e uma atualização automática do site. O disco em `/var/data` preserva cadastros e credenciais entre atualizações; mantenha somente uma instância do serviço. Alterar `ADMIN_PASSWORD` depois da criação não troca a senha já gravada: consulte a recuperação descrita acima. `/healthz` permite verificar a disponibilidade do servidor e do banco sem expor os dados.

Documentação: [discos persistentes](https://render.com/docs/disks), [Blueprints](https://render.com/docs/blueprint-spec) e [preços](https://render.com/pricing).

Variáveis de ambiente: `PORT` (3000), `HOST` (0.0.0.0), `DATA_DIR` (pasta data) e `COOKIE_SECURE=1` (usar ao publicar com HTTPS). Execute apenas uma instância apontando para o mesmo banco. Sessões duram 24 horas e são invalidadas ao reiniciar. O site consulta atualizações a cada minuto fora dos formulários.

## Dados e testes

O SQLite fica em `data/arena.sqlite`; para backup completo, pare o servidor e copie a pasta `data`. O botão **Exportar dados** baixa uma cópia JSON para consulta; restauração por upload não está implementada. Não disponibilize a pasta `data` publicamente.

```powershell
npm test
```

Os testes usam banco temporário separado, validam autenticação, CRUD, persistência após reinício, regras de ranking e rejeição de dados inválidos. A aplicação usa HTML, CSS, JavaScript e os módulos HTTP e SQLite nativos do Node.

## Arte

Imagem: `public/hero.png`. Gerada com a ferramenta integrada imagegen. Prompt utilizado: “Use case: stylized-concept. Asset: widescreen cinematic hero background for a Counter-Strike friends competitive league website. Two realistic fictional tactical counterterrorism operators with helmets, face coverings, tactical vests, carrying rifles pointed down, positioned on the RIGHT half of the frame. Sandy Mediterranean abandoned city courtyard, cinematic smoke and dust, warm muted golden light, charcoal shadows, subtle orange embers, film grain, premium AAA military game key art. LEFT half mostly dark atmospheric empty negative space for website typography. Wide 16:9 composition. No text, no logos, no watermarks. Save image for use in website.”

Referência de direção visual: https://www.callofduty.com/. Projeto independente, sem vínculo com Valve ou Activision.
