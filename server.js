// --- Backend para a aplicação DriverCosts ---
// Versão adaptada para ler as credenciais da base de dados
// a partir das variáveis de ambiente configuradas na Render.

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");

const app = express();
const port = 3001; // Porta onde o servidor vai correr

// Middlewares
app.use(cors());
app.use(express.json());

// --- CONFIGURAÇÃO DA BASE DE DADOS (A LER DA NUVEM) ---
// Esta secção agora usa as variáveis de ambiente que configurou na Render.
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
  ssl: {
    // CORREÇÃO: Esta opção torna a ligação SSL menos restrita,
    // o que é frequentemente necessário para ligar serviços na nuvem.
    rejectUnauthorized: false,
  },
};

// Função para criar a ligação com a base de dados
async function createConnection() {
  return await mysql.createConnection(dbConfig);
}

// --- ROTAS DA API ---

// Rota de teste
app.get("/", (req, res) => {
  res.send("Servidor DriverCosts está a funcionar!");
});

// GET: Obter todos os veículos de um motorista
app.get("/api/vehicles/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const connection = await createConnection();
    await connection.execute(
      "INSERT IGNORE INTO Motorista (id_motorista) VALUES (?)",
      [userId]
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

// POST: Adicionar um novo veículo
app.post("/api/vehicles/:userId", async (req, res) => {
  const { userId } = req.params;
  const vehicleData = { ...req.body };

  vehicleData.id_motorista = userId;

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
    "lucro_desejado_diario",
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
    await connection.end();

    const [newVehicle] = await (
      await createConnection()
    ).execute("SELECT * FROM Veiculo WHERE id_veiculo = ?", [result.insertId]);
    res.status(201).json(newVehicle[0]);
  } catch (error) {
    console.error("Erro ao adicionar veículo:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

// PUT: Atualizar um veículo existente
app.put("/api/vehicles/:userId/:vehicleId", async (req, res) => {
  const { userId, vehicleId } = req.params;
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
    "lucro_desejado_diario",
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
    await connection.end();

    const [updatedVehicle] = await (
      await createConnection()
    ).execute("SELECT * FROM Veiculo WHERE id_veiculo = ?", [vehicleId]);
    res.json(updatedVehicle[0]);
  } catch (error) {
    console.error("Erro ao atualizar veículo:", error);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

// DELETE: Apagar um veículo
app.delete("/api/vehicles/:userId/:vehicleId", async (req, res) => {
  const { userId, vehicleId } = req.params;
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

// GET: Obter todos os logs diários de um veículo
app.get("/api/logs/:vehicleId", async (req, res) => {
  const { vehicleId } = req.params;
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

// POST/PUT (UPSERT): Adicionar ou atualizar um log diário
app.post("/api/logs/:vehicleId", async (req, res) => {
  const { vehicleId } = req.params;
  const logData = req.body;

  if (logData.date) {
    logData.data = logData.date;
    delete logData.date;
  }

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

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor DriverCosts a correr em http://localhost:${port}`);
});
