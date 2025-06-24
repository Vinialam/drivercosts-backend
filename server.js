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
      "A variável de ambiente GOOGLE_APPLICATION_CREDENTIALS_JSON não foi definida na Render."
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

app.post("/api/vehicles", async (req, res) => {
  const { uid } = req.user;
  const vehicleData = { ...req.body, id_motorista: uid };
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ... (outras rotas de veículos: PUT, DELETE)

app.get("/api/logs/:vehicleId", async (req, res) => {
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

app.post("/api/logs/:vehicleId", async (req, res) => {
  const logData = { ...req.body, id_veiculo: req.params.vehicleId };
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
    res.status(500).json({ error: error.message });
  }
});

// --- NOVAS ROTAS PARA CUSTOS FIXOS ---
app.get("/api/costs", async (req, res) => {
  try {
    const connection = await createConnection();
    const [rows] = await connection.execute(
      "SELECT * FROM CustoFixo WHERE id_motorista = ? ORDER BY data_vencimento ASC",
      [req.user.uid]
    );
    await connection.end();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/costs", async (req, res) => {
  const { descricao, valor, data_vencimento } = req.body;
  try {
    const connection = await createConnection();
    const sql =
      "INSERT INTO CustoFixo (id_motorista, descricao, valor, data_vencimento) VALUES (?, ?, ?, ?)";
    const [result] = await connection.execute(sql, [
      req.user.uid,
      descricao,
      valor,
      data_vencimento,
    ]);
    await connection.end();
    res.status(201).json({ id_custo: result.insertId, ...req.body });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/costs/:costId", async (req, res) => {
  try {
    const connection = await createConnection();
    await connection.execute(
      "DELETE FROM CustoFixo WHERE id_custo = ? AND id_motorista = ?",
      [req.params.costId, req.user.uid]
    );
    await connection.end();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Servidor DriverCosts a correr na porta ${port}`);
});
