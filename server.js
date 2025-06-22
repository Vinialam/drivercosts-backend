// --- Backend para a aplicação DriverCosts ---
// Versão com autenticação e verificação de token.

// Passo 1: Instale as dependências:
// npm install express mysql2 cors firebase-admin

// Passo 2: Configure as variáveis de ambiente na Render.

// Passo 3: Faça o download do seu ficheiro de credenciais do Firebase
// e adicione o nome do ficheiro à variável de ambiente GOOGLE_APPLICATION_CREDENTIALS na Render.

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const admin = require("firebase-admin");

// Inicialização do Firebase Admin SDK
// Ele irá procurar automaticamente as credenciais na variável de ambiente.
try {
  admin.initializeApp();
  console.log("Firebase Admin SDK inicializado com sucesso.");
} catch (e) {
  console.error(
    "Erro ao inicializar Firebase Admin SDK. Certifique-se de que as credenciais estão configuradas.",
    e
  );
}

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false },
};

async function createConnection() {
  return await mysql.createConnection(dbConfig);
}

// --- Middleware de Autenticação ---
// Este middleware irá verificar todos os pedidos para rotas protegidas.
const checkAuth = async (req, res, next) => {
  const idToken = req.headers.authorization?.split("Bearer ")[1];
  if (!idToken) {
    return res.status(401).send("Não autorizado: Token não fornecido.");
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken; // Adiciona os dados do utilizador ao pedido
    next();
  } catch (error) {
    console.error("Erro ao verificar token:", error);
    return res.status(403).send("Não autorizado: Token inválido.");
  }
};

// --- ROTAS DA API (Protegidas) ---

app.get("/", (req, res) => res.send("Servidor DriverCosts está a funcionar!"));

// Todas as rotas abaixo agora exigem um token válido.
app.use("/api", checkAuth);

app.get("/api/vehicles", async (req, res) => {
  const userId = req.user.uid;
  try {
    const connection = await createConnection();
    await connection.execute(
      "INSERT IGNORE INTO Motorista (id_motorista, email, nome) VALUES (?, ?, ?)",
      [userId, req.user.email, req.user.name || null]
    );
    const [rows] = await connection.execute(
      "SELECT * FROM Veiculo WHERE id_motorista = ?",
      [userId]
    );
    await connection.end();
    res.json(rows);
  } catch (error) {
    console.error("Erro ao obter veículos:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.post("/api/vehicles", async (req, res) => {
  const userId = req.user.uid;
  const vehicleData = { ...req.body, id_motorista: userId };

  const numericFields = [
    "ano",
    "financiamento",
    "seguro",
    "manutencao",
    "outras_despesas_fixas",
    "despesas_pessoais",
    "dias_trabalho",
    "custo_combustivel",
    "consumo_km_por_litro",
    "custo_eletricidade_kwh",
  ];
  for (const field of numericFields) {
    if (vehicleData[field] === "" || vehicleData[field] == null) {
      vehicleData[field] = null;
    }
  }

  try {
    const connection = await createConnection();
    const columns = Object.keys(vehicleData).join(", ");
    const placeholders = Object.keys(vehicleData)
      .map(() => "?")
      .join(", ");
    const values = Object.values(vehicleData);

    const sql = `INSERT INTO Veiculo (${columns}) VALUES (${placeholders})`;
    const [result] = await connection.execute(sql, values);

    const [newVehicle] = await connection.execute(
      "SELECT * FROM Veiculo WHERE id_veiculo = ?",
      [result.insertId]
    );
    await connection.end();

    res.status(201).json(newVehicle[0]);
  } catch (error) {
    console.error("Erro ao adicionar veículo:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.put("/api/vehicles/:vehicleId", async (req, res) => {
  const userId = req.user.uid;
  const { vehicleId } = req.params;
  const vehicleData = { ...req.body };
  delete vehicleData.id_veiculo;

  const numericFields = [
    "ano",
    "financiamento",
    "seguro",
    "manutencao",
    "outras_despesas_fixas",
    "despesas_pessoais",
    "dias_trabalho",
    "custo_combustivel",
    "consumo_km_por_litro",
    "custo_eletricidade_kwh",
  ];
  for (const field of numericFields) {
    if (vehicleData[field] === "" || vehicleData[field] == null) {
      vehicleData[field] = null;
    }
  }

  try {
    const connection = await createConnection();
    const setClauses = Object.keys(vehicleData)
      .map((key) => `${key} = ?`)
      .join(", ");
    const values = [...Object.values(vehicleData), vehicleId, userId];

    const sql = `UPDATE Veiculo SET ${setClauses} WHERE id_veiculo = ? AND id_motorista = ?`;
    await connection.execute(sql, values);

    const [updatedVehicle] = await connection.execute(
      "SELECT * FROM Veiculo WHERE id_veiculo = ?",
      [vehicleId]
    );
    await connection.end();
    res.json(updatedVehicle[0]);
  } catch (error) {
    console.error("Erro ao atualizar veículo:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.delete("/api/vehicles/:vehicleId", async (req, res) => {
  const userId = req.user.uid;
  const { vehicleId } = req.params;
  try {
    const connection = await createConnection();
    await connection.execute(
      "DELETE FROM Veiculo WHERE id_veiculo = ? AND id_motorista = ?",
      [vehicleId, userId]
    );
    await connection.end();
    res.status(204).send();
  } catch (error) {
    console.error("Erro ao apagar veículo:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.get("/api/logs/:vehicleId", async (req, res) => {
  const { vehicleId } = req.params;
  // Adicional: verificar se o veículo pertence ao utilizador autenticado
  try {
    const connection = await createConnection();
    const [rows] = await connection.execute(
      "SELECT * FROM LogDiario WHERE id_veiculo = ?",
      [vehicleId]
    );
    await connection.end();
    res.json(rows);
  } catch (error) {
    console.error("Erro ao obter logs:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.post("/api/logs/:vehicleId", async (req, res) => {
  const { vehicleId } = req.params;
  const logData = req.body;
  logData.id_veiculo = vehicleId;

  const columns = Object.keys(logData).join(", ");
  const placeholders = Object.keys(logData)
    .map(() => "?")
    .join(", ");
  const values = Object.values(logData);
  const onUpdate = Object.keys(logData)
    .map((key) => `${key} = VALUES(${key})`)
    .join(", ");
  const sql = `INSERT INTO LogDiario (${columns}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${onUpdate}`;

  try {
    const connection = await createConnection();
    await connection.execute(sql, values);
    await connection.end();
    res.status(201).json(logData);
  } catch (error) {
    console.error("Erro ao salvar log:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Servidor DriverCosts a correr na porta ${port}`);
});
