import axios from "axios";
import fastify from "fastify";

const kernel = fastify({ logger: true });

// Configuração da API do Grok
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Cardápio da lanchonete
const MENU = {
  lanches: [
    { id: 1, name: "Hamburguer Simples", price: 15.0 },
    { id: 2, name: "Hamburguer Duplo", price: 20.0 },
    { id: 3, name: "X-Tudo", price: 25.0 },
  ],
  bebidas: [
    { id: 4, name: "Refrigerante 300ml", price: 5.0 },
    { id: 5, name: "Suco Natural", price: 7.0 },
  ],
};

// Estados dos usuários (em memória, substitua por banco de dados em produção)
const userStates = new Map(); // chave: chatId, valor: { state, order }

// Função para chamar o Grok
async function getGrokResponse(chatId, message) {
  const state = userStates.get(chatId) || { state: "start", order: [] };
  let prompt = "";

  switch (state.state) {
    case "start":
      prompt = `Você é um atendente de uma lanchonete chamado Maiyu Bot. O cliente disse: "${message}". Responda de forma amigável e sugira opções como "ver cardápio", "fazer pedido" ou "ajuda".`;
      break;
    case "ordering":
      prompt = `Você é um atendente de uma lanchonete chamado Maiyu Bot. O cliente está fazendo um pedido e disse: "${message}". O cardápio é: ${JSON.stringify(
        MENU
      )}. Identifique o item pedido ou peça esclarecimentos. Responda apenas com a mensagem, sem explicações extras.`;
      break;
    case "confirming":
      prompt = `Você é um atendente de uma lanchonete chamado Maiyu Bot. O pedido atual é: ${JSON.stringify(
        state.order
      )}. O cliente disse: "${message}". Confirme o pedido ou ajuste conforme solicitado. Sugira "finalizar" ou "adicionar mais itens".`;
      break;
    default:
      prompt = message;
  }

  try {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "Você é um atendente de uma lanchonete chamado Maiyu Bot. Responda como Maiyu Bot e inclua seu nome nas mensagens.",
          },
          { role: "user", content: prompt },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
      }
    );
    const grokText = response.data.choices[0].message.content;
    return `Oi, eu sou o Maiyu Bot! ${grokText}`; // Adiciona o nome manualmente
  } catch (error) {
    console.error(
      "Erro ao chamar o Grok:",
      error.response?.data || error.message
    );
    return "Oi, eu sou o Maiyu Bot! Desculpe, algo deu errado. Tente novamente!";
  }
}

// Função para enviar mensagem via WAHA
async function sendMessage(session, chatId, text) {
  await axios.post("http://localhost:3001/api/sendText", {
    session,
    chatId,
    text,
  });
}

// Rota do webhook
kernel.post("/webhook", async (request, reply) => {
  const { event, session, payload } = request.body;

  if (event !== "message" || !payload?.body) {
    return reply.status(200).send(); // Ignora eventos que não são mensagens
  }

  const chatId = payload.from; // Quem enviou a mensagem
  const text = payload.body; // Conteúdo da mensagem

  console.log("Payload recebido:", { session, chatId, text });

  // Obtém ou inicializa o estado do usuário
  let state = userStates.get(chatId) || { state: "start", order: [] };

  // Lógica de controle do fluxo
  let responseText = "";
  if (text.toLowerCase().includes("cardápio")) {
    responseText =
      "Aqui está nosso cardápio:\n" +
      MENU.lanches
        .map((item) => `${item.id}. ${item.name} - R$${item.price.toFixed(2)}`)
        .join("\n") +
      "\n" +
      MENU.bebidas
        .map((item) => `${item.id}. ${item.name} - R$${item.price.toFixed(2)}`)
        .join("\n") +
      "\n" +
      "Digite o número do item para pedir!";
    state.state = "ordering";
  } else if (text.toLowerCase().includes("finalizar")) {
    if (state.order.length === 0) {
      responseText =
        "Seu pedido está vazio. Quer adicionar algo antes de finalizar?";
    } else {
      const total = state.order.reduce((sum, item) => sum + item.price, 0);
      responseText = `Seu pedido:\n${state.order
        .map((item) => `- ${item.name} (R$${item.price.toFixed(2)})`)
        .join("\n")}\nTotal: R$${total.toFixed(
        2
      )}\nConfirme com "sim" ou adicione mais itens!`;
      state.state = "confirming";
    }
  } else if (text.toLowerCase() === "sim" && state.state === "confirming") {
    responseText =
      "Pedido confirmado! Em breve entraremos em contato. Obrigado!";
    state = { state: "start", order: [] }; // Reseta o estado
  } else if (state.state === "ordering" && /^\d+$/.test(text)) {
    const itemId = parseInt(text);
    const item = [...MENU.lanches, ...MENU.bebidas].find(
      (i) => i.id === itemId
    );
    if (item) {
      state.order.push(item);
      responseText = `${item.name} adicionado ao pedido! Quer mais alguma coisa? Digite o número ou "finalizar".`;
    } else {
      responseText =
        "Item não encontrado. Digite um número válido do cardápio!";
    }
  } else {
    // Usa o Grok para respostas mais naturais fora dos comandos fixos
    responseText = await getGrokResponse(chatId, text);
  }

  // Atualiza o estado do usuário
  userStates.set(chatId, state);

  // Envia a resposta ao cliente
  await sendMessage(session, chatId, responseText);
  console.log("Resposta enviada:", responseText);

  return reply.status(200).send();
});

kernel
  .listen({ port: 3000, host: "0.0.0.0" })
  .then(() => {
    console.info("HTTP Server running on http://localhost:3000");
  })
  .catch((err) => {
    console.error("Erro ao iniciar o servidor:", err);
    process.exit(1);
  });
