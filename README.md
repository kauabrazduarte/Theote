# Theote

Mundo 3D com quatro moradores, simulação em tempo real e decisões por IA.

Um dia dura 30 minutos reais. Arraste o mapa para mover a câmera. Cada morador acompanha fome, sede, moedas e inventário; compra na banca e pode doar itens a quem estiver perto. A reunião das 12:00 reúne os moradores por 15 minutos do mundo. Com 1000 moedas, uma pessoa pode sair sozinha para ver o exterior.

Os moradores podem propor acordos escritos com base em uma fala recente. O destinatário decide se assina ou recusa, e o histórico fica na aba Acordos. A assinatura registra o compromisso, sem executar o plano automaticamente.

## Executar localmente

Requer Bun e Docker com o daemon em execução.

1. Copie `apps/api/.env.example` para `apps/api/.env` e defina `POSTGRES_PASSWORD`. Use a mesma senha em `DATABASE_URL`.
2. Para ativar as decisões por IA, defina `OPENROUTER_API_KEY` e um valor positivo em `WORLD_MONTHLY_BUDGET_USD`. Sem a chave, o mundo e a interface continuam disponíveis, mas as decisões por IA ficam pausadas.
3. Execute `bun install` e `bun run dev` na raiz do projeto.
4. Acesse <http://localhost:5173/>. A API fica em <http://127.0.0.1:3001/>.

`bun run dev` inicia o Postgres, aguarda o banco ficar saudável e então inicia a API e o site. O volume do Postgres preserva os dados entre execuções. Para conferir o build do site, execute `bun run build`.
