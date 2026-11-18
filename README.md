# Rotas de Entrega — Moto Chefe Maringá

Sistema web para planejar as rotas dos entregadores. Ele faz o seguinte:

- **Login com usuário e senha.** O administrador planeja as rotas. Cada entregador entra com o seu próprio usuário e vê só as rotas dele.
- **Busca de CEP.** O endereço é preenchido sozinho pelo ViaCEP; falta só digitar o número.
- **Melhor ordem das entregas,** calculada pelas ruas reais com o Google Maps (OpenRouteService de reserva). O sistema diz qual entrega fazer na ida e qual na volta, e aceita entregas marcadas como urgentes.
- **Link pronto do Google Maps.** O entregador abre o link e toca em *Iniciar*. Também é possível enviar a rota pelo WhatsApp com um clique.
- **Gasto de combustível por rota:** km da rota ÷ média de km por litro do veículo (ex.: Saveiro) × preço do litro do dia. O preço fica gravado em cada rota, então o relatório usa o valor da época.
- **Produto entregue:** em cada entrega você escolhe o modelo de scooter da linha Moto Chefe (JET, JET MAX, R10, X12, GIGA, MIA, X11, MC20, ROMA) ou acessório.
- **Banco de dados com todas as rotas** e **relatório do mês**: entregas feitas, km, litros, gasto total, gasto por entrega, preço médio do litro, totais por veículo, por entregador, por dia e scooters entregues por modelo.
- **Você decide o caminho:** o sistema sempre sugere a melhor ordem, mas quem planeja pode mudar com ▲ ▼ ou escolher outra opção na comparação. A tela mostra quantos km e reais a mais a ordem escolhida custa.
- **Pedágio:** o sistema verifica se a rota passa por pedágio. Se o Google informar o valor, ele já vem preenchido; senão, você digita. O pedágio entra no gasto da rota e no relatório.
- **Folha de entrega para imprimir:** em preto e branco, uma folha por rota, com nome de quem recebe, endereço, telefone, produto e espaço para assinatura. Botão **Imprimir** em **Rotas** (e para o entregador em *Minhas rotas*).
- **Exportação do relatório em Excel (.xlsx)** com 3 abas (Resumo, Rotas e Entregas) ou em CSV.

Não precisa instalar nenhuma biblioteca: basta o Node.js 22 (ou Docker). O banco é um arquivo SQLite.

---

## 1. Testar no seu computador (opcional)

Instale o Node.js 22 (nodejs.org), abra o terminal na pasta do projeto e rode:

```bash
DEMO=1 ADMIN_USUARIO=admin ADMIN_SENHA=123456 node src/server.js
```

No Windows (PowerShell):

```powershell
$env:DEMO="1"; $env:ADMIN_USUARIO="admin"; $env:ADMIN_SENHA="123456"; node src/server.js
```

Depois abra http://localhost:3000. Sem chave do Google, o sistema roda em **modo demonstração**, com distâncias aproximadas.

---

## 2. Pegar as chaves de mapa (grátis, sem cartão)

O sistema usa dois serviços de mapa:

- **Principal: chave de demonstração do Google** (Maps Demo Key). Ela é gratuita e não pede cartão. Quando o limite diário acaba, o Google pausa o uso até o dia seguinte, sem cobrança.
- **Reserva: OpenRouteService.** Também é gratuito e não pede cartão.

Se o Google não responder ou não achar um endereço, o sistema usa o OpenRouteService sozinho e mostra um aviso na tela da rota. O entregador nunca fica sem rota.

**Chave de demonstração do Google**
1. Entre com uma **conta Google pessoal (@gmail.com)**. Contas corporativas do Google Workspace não podem usar.
2. Acesse https://developers.google.com/maps/demo-key e clique em **Get a Demo Key**.
3. Aceite os termos e copie a chave. Ela vai na variável `GOOGLE_MAPS_DEMO_KEY`.

**Chave do OpenRouteService**
1. Acesse https://account.heigit.org e crie uma conta gratuita.
2. Confirme o e-mail, entre no painel e crie uma chave (API Key/Token) com o nome "rotas".
3. Copie a chave. Ela vai na variável `ORS_API_KEY`.

> O Google indica a chave de demonstração para testes e protótipos, não para produção, e os limites dela podem mudar. Por isso o OpenRouteService fica sempre de reserva.
> Se um dia quiser o Google oficial, ative o faturamento no Google Cloud (Geocoding API + Routes API) e coloque a chave em `GOOGLE_MAPS_API_KEY`. Ela substitui a de demonstração sem mexer em mais nada.
> Em **Configurações**, um selo mostra qual serviço está ativo e qual é a reserva.

## 3. Colocar no ar (Railway, recomendado)

O Railway hospeda o site e guarda o banco de dados num disco permanente. O plano é pago, mas barato; confira o valor em https://railway.com/pricing.

1. Crie uma conta no **GitHub** e suba esta pasta como um repositório privado. Pode arrastar os arquivos em *Add file → Upload files*.
2. Entre em https://railway.com com a conta do GitHub → **New Project → Deploy from GitHub repo** → escolha o repositório. O Railway encontra o `Dockerfile` sozinho.
3. No serviço criado, abra **Variables** e adicione:

   | Variável | Valor |
   |---|---|
   | `ADMIN_USUARIO` | seu usuário, por exemplo `alessandro` |
   | `ADMIN_SENHA` | uma senha forte |
   | `GOOGLE_MAPS_DEMO_KEY` | a chave de demonstração do Google (passo 2) |
   | `ORS_API_KEY` | a chave do OpenRouteService (passo 2) |
   | `DB_PATH` | `/app/data/rotas.db` |

4. Clique com o botão direito no serviço → **Attach Volume** → *Mount path*: `/app/data`. **Esse passo é obrigatório:** sem o volume, o banco de dados é apagado a cada atualização.
5. Em **Settings → Networking → Generate Domain**. Isso gera um endereço como `rotas-motochefe.up.railway.app`.
6. *(opcional)* Para usar `rotas.motochefemaringa.com.br`, clique em **Custom Domain** no Railway e crie o registro CNAME que ele mostrar no painel onde o seu domínio está registrado.

Pronto: acesse o endereço, entre com o usuário e a senha que você definiu e configure o sistema (seção 4).

> Também funciona em qualquer servidor com Docker:
> `docker build -t rotas . && docker run -d -p 80:3000 -v rotas-dados:/app/data --env-file .env rotas`

---

## 4. Primeiro uso

1. **Configurações:**
   - Digite o CEP e o número da loja: esse é o ponto de saída.
   - Coloque o **preço atual do combustível**.
2. **Veículos → Adicionar veículo:** cadastre a Saveiro com a **média de km por litro** (a média real, carregada, na cidade).
3. **Usuários → Novo usuário:** crie um login para cada entregador.
4. **Nova rota:** escolha o entregador e o veículo, digite o CEP e o número de cada entrega e clique em **Calcular melhor rota**. Depois:
   - Envie pelo WhatsApp, ou o entregador abre em *Minhas rotas*.
   - Clique em **Salvar rota** para ela entrar no relatório.
5. No fim do mês: **Relatório do mês → Exportar Excel.**

### Logo e cores

O sistema usa o amarelo (#f4c400) e o preto da Moto Chefe, com a marca escrita: MOTO CHEFE em amarelo e MARINGÁ em branco.

### Como o custo é calculado

- **Litros** = km da rota ÷ média de km/l do veículo.
- **Gasto** = litros × preço do litro informado na rota (o preço do dia). Se errar o preço, corrija em **Rotas → abrir a rota → Corrigir preço do litro**.
- **Tempo:** o maior valor entre o tempo do Google e o tempo pela velocidade média do veículo, mais os minutos parados em cada entrega.

### Limites

- Até **8 entregas por rota**. O link do Google Maps aceita 10 pontos ao todo, contando a saída e a chegada. Acima disso, divida em duas rotas.
- Se o Google não achar um endereço, confira o número e o CEP.

### Backup

- Exporte o Excel todo mês.
- No Railway, o volume pode ter backups automáticos: veja em *Volume → Backups*.

---

## Estrutura

```
src/server.js    servidor web e API
src/db.js        banco SQLite (tabelas e configurações)
src/auth.js      login, senhas (scrypt) e sessões
src/maps.js      ViaCEP, Google Maps / OpenRouteService
src/planner.js   melhor ordem, tempo, energia e custo
src/report.js    relatório mensal, Excel e CSV
src/print.js     folha de entrega para imprimir
src/xlsx.js      gerador de planilha .xlsx
src/catalog.js   modelos Moto Chefe (produtos entregues)
public/          telas (login e painel)
```
