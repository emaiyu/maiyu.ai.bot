import fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { GROQ_API } from "../config/groq-api";
import { WPP_API } from "../config/wpp-api";
import { Env } from "../start/env";

// ======= Tipos ========
interface MenuItem {
  id: number;
  name: string;
  price: number;
}

interface UserState {
  state: "start" | "ordering" | "confirming";
  order: MenuItem[];
}

interface ChatParams {
  text: string;
  chatId: string;
}

interface WhatsAppMessage {
  chatId: string;
  to: string;
  text: string;
}

// ======= Constantes ========
const VERIFY_TOKEN = "WPP_AI_BOT_VERIFY_TOKEN";
const BOT_NAME = "Maiyu Bot";
const WHATSAPP_BUSINESS_ID = "610520802137456";

// ======= Menu da lanchonete ========
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

// ======= Validação ========
const schemas = {
  webhook: {
    body: z.record(z.any()),
    query: z.object({
      "hub.mode": z.string(),
      "hub.verify_token": z.string(),
      "hub.challenge": z.string(),
    }),
  },
  sendText: z.object({
    to: z
      .string()
      .trim()
      .transform((value) => value.replace(/\D/g, "")),
    message: z.string().trim(),
    link: z.string().trim().optional(),
  }),
};

// ======= Estado em memória ========
const userStates = new Map<string, UserState>();

// ======= Classes do aplicativo ========
class MenuService {
  static getAllItems(): MenuItem[] {
    return [...MENU.lanches, ...MENU.bebidas];
  }

  static findItemById(id: number): MenuItem | undefined {
    return this.getAllItems().find((item) => item.id === id);
  }

  static formatMenu(): string {
    return [
      "Aqui está nosso cardápio:",
      ...MENU.lanches.map(
        (item) => `${item.id}. ${item.name} - R$${item.price.toFixed(2)}`
      ),
      "",
      ...MENU.bebidas.map(
        (item) => `${item.id}. ${item.name} - R$${item.price.toFixed(2)}`
      ),
      "",
      "Digite o número do item para pedir!",
    ].join("\n");
  }

  static formatOrder(order: MenuItem[]): string {
    if (order.length === 0) return "Seu pedido está vazio.";

    const total = order.reduce((sum, item) => sum + item.price, 0);
    return [
      "Seu pedido:",
      ...order.map((item) => `- ${item.name} (R$${item.price.toFixed(2)})`),
      `Total: R$${total.toFixed(2)}`,
    ].join("\n");
  }
}

class UserStateManager {
  static get(chatId: string): UserState {
    if (!userStates.has(chatId)) {
      this.reset(chatId);
    }
    return userStates.get(chatId)!;
  }

  static update(chatId: string, state: Partial<UserState>): UserState {
    const currentState = this.get(chatId);
    const newState = { ...currentState, ...state };
    userStates.set(chatId, newState);
    return newState;
  }

  static reset(chatId: string): UserState {
    const initialState: UserState = { state: "start", order: [] };
    userStates.set(chatId, initialState);
    return initialState;
  }
}

class AIService {
  static async getResponse(chatId: string, message: string): Promise<string> {
    const state = UserStateManager.get(chatId);
    let prompt = this.generatePrompt(state, message);

    try {
      console.info(
        `Enviando prompt para o Groq: ${prompt.substring(0, 100)}...`
      );

      const response = await GROQ_API.post("/chat/completions", {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `Você é um atendente de uma lanchonete chamado ${BOT_NAME}. Responda como ${BOT_NAME} incluindo seu nome na primeira saudação apenas.`,
          },
          { role: "user", content: prompt },
        ],
      });

      const grokText = response.data.choices[0].message.content;

      // Verifica se a resposta já inclui o nome do bot
      if (grokText.includes(BOT_NAME)) {
        return grokText;
      } else {
        return `Oi, eu sou o ${BOT_NAME}! ${grokText}`;
      }
    } catch (error) {
      console.error(
        "Erro ao chamar o Groq:",
        error.response?.data || error.message
      );
      return `Oi, eu sou o ${BOT_NAME}! Desculpe, algo deu errado. Tente novamente!`;
    }
  }

  private static generatePrompt(state: UserState, message: string): string {
    switch (state.state) {
      case "start":
        return `Você é um atendente de uma lanchonete chamado ${BOT_NAME}. O cliente disse: "${message}". Responda de forma amigável e sugira opções como "ver cardápio", "fazer pedido" ou "ajuda".`;
      case "ordering":
        return `Você é um atendente de uma lanchonete chamado ${BOT_NAME}. O cliente está fazendo um pedido e disse: "${message}". O cardápio é: ${JSON.stringify(
          MENU
        )}. Identifique o item pedido ou peça esclarecimentos. Responda apenas com a mensagem, sem explicações extras.`;
      case "confirming":
        return `Você é um atendente de uma lanchonete chamado ${BOT_NAME}. O pedido atual é: ${JSON.stringify(
          state.order
        )}. O cliente disse: "${message}". Confirme o pedido ou ajuste conforme solicitado. Sugira "finalizar" ou "adicionar mais itens".`;
      default:
        return message;
    }
  }
}

class ChatBot {
  static async processMessage({ text, chatId }: ChatParams): Promise<string> {
    const state = UserStateManager.get(chatId);
    console.info(`Processando mensagem de ${chatId}: ${text}`);

    // Verifica comandos especiais
    if (text.toLowerCase().includes("cardápio")) {
      UserStateManager.update(chatId, { state: "ordering" });
      return MenuService.formatMenu();
    }

    if (text.toLowerCase().includes("finalizar")) {
      return this.handleFinalize(chatId, state);
    }

    if (text.toLowerCase() === "sim" && state.state === "confirming") {
      UserStateManager.reset(chatId);
      return "Pedido confirmado! Em breve entraremos em contato. Obrigado!";
    }

    if (state.state === "ordering" && /^\d+$/.test(text)) {
      return this.handleOrderItem(chatId, text, state);
    }

    // Usa o LLM para respostas mais naturais
    try {
      return await AIService.getResponse(chatId, text);
    } catch (error) {
      console.error("Erro ao chamar o LLM:", error);
      return `Oi, eu sou o ${BOT_NAME}! Desculpe, houve um erro ao processar sua mensagem.`;
    }
  }

  private static handleFinalize(chatId: string, state: UserState): string {
    if (state.order.length === 0) {
      return "Seu pedido está vazio. Quer adicionar algo antes de finalizar?";
    }

    UserStateManager.update(chatId, { state: "confirming" });
    return `${MenuService.formatOrder(
      state.order
    )}\nConfirme com "sim" ou adicione mais itens!`;
  }

  private static handleOrderItem(
    chatId: string,
    text: string,
    state: UserState
  ): string {
    const itemId = parseInt(text);
    const item = MenuService.findItemById(itemId);

    if (!item) {
      return "Item não encontrado. Digite um número válido do cardápio!";
    }

    // Adiciona item ao pedido
    const updatedOrder = [...state.order, item];
    UserStateManager.update(chatId, { order: updatedOrder });

    return `${item.name} adicionado ao pedido! Quer mais alguma coisa? Digite o número ou "finalizar".`;
  }
}

class WhatsAppService {
  static async sendMessage(to: string, message: string, link?: string) {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: link,
        body: message,
      },
    };

    try {
      console.log(
        "Enviando mensagem via WhatsApp:",
        JSON.stringify(payload, null, 2)
      );
      const { data } = await WPP_API.post(
        `/${WHATSAPP_BUSINESS_ID}/messages`,
        payload
      );
      console.info(`Mensagem enviada para ${to}`);
      return data;
    } catch (error) {
      console.error(
        `Erro ao enviar mensagem para ${to}:`,
        error.response?.data || error.message
      );
      throw error;
    }
  }

  static parseWebhookEntry(entry: any): WhatsAppMessage | null {
    if (!entry?.id) return null;

    const chatId = entry.id;
    const [changes] = entry.changes || [];
    if (!changes?.value) return null;

    const { value } = changes;
    if (!value?.messages || !value?.contacts) return null;

    const [message] = value.messages || [];
    if (!message?.text) return null;

    const [contact] = value.contacts || [];
    if (!contact?.wa_id) return null;

    return {
      chatId,
      to: contact.wa_id,
      text: message.text.body,
    };
  }
}

// ======= Configuração do servidor ========
class LanchoneteServer {
  private server: FastifyInstance;

  constructor() {
    this.server = fastify({ logger: false });
    this.registerRoutes();
  }

  private registerRoutes() {
    // Rota de verificação do webhook (GET)
    this.server.get("/webhook", async (request, reply) => {
      try {
        const query = schemas.webhook.query.parse(request.query);

        if (
          !(
            query["hub.mode"] === "subscribe" &&
            query["hub.verify_token"] === VERIFY_TOKEN
          )
        ) {
          return reply
            .code(403)
            .send({ error: "Token de verificação inválido" });
        }

        return reply.status(200).send(query["hub.challenge"]);
      } catch (error) {
        console.error("Erro na verificação do webhook:", error);
        return reply
          .status(400)
          .send({ error: "Parâmetros de verificação inválidos" });
      }
    });

    // Rota de recebimento de mensagens (POST)
    this.server.post("/webhook", async (request, reply) => {
      try {
        const body = schemas.webhook.body.parse(request.body);

        if (
          !(
            body?.object === "whatsapp_business_account" &&
            body?.entry &&
            Array.isArray(body.entry) &&
            body.entry.length > 0
          )
        ) {
          return reply
            .status(400)
            .send({ error: "Formato de webhook inválido" });
        }

        const [entry] = body.entry;
        const message = WhatsAppService.parseWebhookEntry(entry);

        if (!message) {
          return reply
            .status(400)
            .send({ error: "Formato de mensagem inválido" });
        }

        const { chatId, to, text } = message;
        console.info(`Recebido webhook para chatId: ${chatId}, texto: ${text}`);

        const responseText = await ChatBot.processMessage({ text, chatId });
        await WhatsAppService.sendMessage(to, responseText);

        return reply.status(200).send({ success: true });
      } catch (error) {
        console.error("Erro ao processar webhook:", error);
        return reply
          .status(500)
          .send({ error: "Erro interno ao processar webhook" });
      }
    });

    // Rota para envio de mensagens (API)
    this.server.post("/send-text", async (request, reply) => {
      try {
        const { to, message, link } = schemas.sendText.parse(request.body);
        const data = await WhatsAppService.sendMessage(to, message, link);
        return reply.status(200).send({ success: true, data });
      } catch (error) {
        console.error("Erro ao enviar texto:", error);
        return reply.status(500).send({ error: "Erro ao enviar mensagem" });
      }
    });
  }

  async start() {
    try {
      await this.server.listen({ port: Env.PORT, host: "0.0.0.0" });
      console.info(`HTTP Server running on http://localhost:${Env.PORT}`);
    } catch (err) {
      console.error("Erro ao iniciar o servidor:", err);
      process.exit(1);
    }
  }
}

// ======= Inicialização ========
const app = new LanchoneteServer();
app.start();
