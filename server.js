const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const admin = require("firebase-admin");

try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    const serviceAccount = JSON.parse(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    );
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("Firebase Admin SDK inicializado.");
  } else {
    throw new Error(
      "Variável GOOGLE_APPLICATION_CREDENTIALS_JSON não definida."
    );
  }
} catch (e) {
  console.error("ERRO CRÍTICO ao inicializar Firebase Admin SDK:", e.message);
  process.exit(1);
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

const checkAuth = async (req, res, next) => {
  const idToken = req.headers.authorization?.split("Bearer ")[1];
  if (!idToken) return res.status(401).send("Não autorizado");
  try {
    req.user = await admin.auth().verifyIdToken(idToken);
    next();
  } catch (error) {
    res.status(403).send("Token inválido");
  }
};

app.get("/", (req, res) => res.send("Servidor DriverCosts está a funcionar!"));
app.use("/api", checkAuth);

// Rotas de Veículos
app.get("/api/vehicles", async (req, res) => {
  const { uid, email, name } = req.user;
  try {
    const connection = await createConnection();
    await connection.execute(
      "INSERT IGNORE INTO Motorista (id_motorista, email, nome) VALUES (?, ?, ?)",
      [uid, email, name || null]
    );
    const [rows] = await connection.execute(
      "SELECT * FROM Veiculo WHERE id_motorista = ?",
      [uid]
    );
    await connection.end();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ... (outras rotas de veículos: POST, PUT, DELETE)

// Rotas de Logs Diários
app.get("/api/logs/:vehicleId", async (req, res) => {
  // Adicionar verificação de dono do veículo
  try {
    const connection = await createConnection();
    const [rows] = await connection.execute(
      "SELECT * FROM LogDiario WHERE id_veiculo = ?",
      [req.params.vehicleId]
    );
    await connection.end();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ... (outra rota de Log: POST)

// --- NOVAS ROTAS PARA CUSTOS FIXOS ---
app.get("/api/costs", async (req, res) => {
  const userId = req.user.uid;
  try {
    const connection = await createConnection();
    const [rows] = await connection.execute(
      "SELECT * FROM CustoFixo WHERE id_motorista = ? ORDER BY data_vencimento ASC",
      [userId]
    );
    await connection.end();
    res.json(rows);
  } catch (error) {
    console.error("Erro ao obter custos:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.post("/api/costs", async (req, res) => {
  const userId = req.user.uid;
  const { descricao, valor, data_vencimento } = req.body;
  try {
    const connection = await createConnection();
    const sql =
      "INSERT INTO CustoFixo (id_motorista, descricao, valor, data_vencimento) VALUES (?, ?, ?, ?)";
    const [result] = await connection.execute(sql, [
      userId,
      descricao,
      valor,
      data_vencimento,
    ]);
    await connection.end();
    res.status(201).json({ id_custo: result.insertId, ...req.body });
  } catch (error) {
    console.error("Erro ao adicionar custo:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.delete("/api/costs/:costId", async (req, res) => {
  const userId = req.user.uid;
  const { costId } = req.params;
  try {
    const connection = await createConnection();
    await connection.execute(
      "DELETE FROM CustoFixo WHERE id_custo = ? AND id_motorista = ?",
      [costId, userId]
    );
    await connection.end();
    res.status(204).send();
  } catch (error) {
    console.error("Erro ao apagar custo:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Servidor DriverCosts a correr na porta ${port}`);
});
