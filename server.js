const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const admin = require("firebase-admin");

// --- Inicialização do Firebase Admin SDK ---
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    const serviceAccount = JSON.parse(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin SDK inicializado com sucesso.");
  } else {
    throw new Error(
      "A variável de ambiente GOOGLE_APPLICATION_CREDENTIALS_JSON não foi definida."
    );
  }
} catch (e) {
  console.error("ERRO CRÍTICO ao inicializar Firebase Admin SDK:", e.message);
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3001;

// --- Middlewares ---
app.use(cors());
app.use(express.json());

// --- Configuração da Base de Dados ---
const dbConfig = process.env.DATABASE_URL
  ? {
      uri: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      port: process.env.DB_PORT,
      ssl: {
        rejectUnauthorized: false,
      },
    };

async function createConnection() {
  return await mysql.createConnection(dbConfig);
}

// --- Middleware de Autenticação ---
const checkAuth = async (req, res, next) => {
  const idToken = req.headers.authorization?.split("Bearer ")[1];
  if (!idToken) {
    return res.status(401).send("Não autorizado: Token não fornecido.");
  }
  try {
    req.user = await admin.auth().verifyIdToken(idToken);
    next();
  } catch (error) {
    res.status(403).send("Token inválido ou expirado.");
  }
};

// --- Rotas Públicas ---
app.get("/", (req, res) => res.send("Servidor DriverCosts está a funcionar!"));

// --- Rotas Protegidas ---
app.use("/api", checkAuth);

// Rota para criar motorista (se não existir)
app.post("/api/motoristas", async (req, res) => {
  const { id_motorista, email, nome } = req.body;
  if (!id_motorista || !email) {
    return res
      .status(400)
      .json({ error: "ID do motorista e email são obrigatórios." });
  }

  let connection;
  try {
    connection = await createConnection();
    const sql =
      "INSERT INTO Motorista (id_motorista, email, nome) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE nome = VALUES(nome)";
    await connection.execute(sql, [
      id_motorista,
      email,
      nome || "Novo Utilizador",
    ]);
    await connection.end();
    res.status(201).json({ message: "Motorista criado ou já existente." });
  } catch (e) {
    console.error("Erro na rota /api/motoristas:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

// --- ROTAS DE VEÍCULOS ---
app.get("/api/vehicles", async (req, res) => {
  const { uid } = req.user;
  let connection;
  try {
    connection = await createConnection();
    const [rows] = await connection.execute(
      "SELECT * FROM Veiculo WHERE id_motorista = ?",
      [uid]
    );
    await connection.end();
    res.json(rows);
  } catch (e) {
    console.error("Erro na rota GET /api/vehicles:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/vehicles", async (req, res) => {
  const { uid } = req.user;
  const {
    marca,
    modelo,
    placa,
    ano,
    tipo,
    preco_litro_combustivel,
    km_por_litro,
    capacidade_bateria,
    autonomia_carga_cheia,
  } = req.body;
  const sql = `
    INSERT INTO Veiculo 
    (id_motorista, marca, modelo, placa, ano, tipo, preco_litro_combustivel, km_por_litro, capacidade_bateria, autonomia_carga_cheia) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    uid,
    marca,
    modelo,
    placa,
    ano,
    tipo,
    preco_litro_combustivel,
    km_por_litro,
    capacidade_bateria,
    autonomia_carga_cheia,
  ];
  let connection;
  try {
    connection = await createConnection();
    const [result] = await connection.execute(sql, values);
    await connection.end();
    res.status(201).json({ id: result.insertId, ...req.body });
  } catch (e) {
    console.error("Erro na rota POST /api/vehicles:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/vehicles/:id", async (req, res) => {
  const { uid } = req.user;
  const { id } = req.params;
  const {
    marca,
    modelo,
    placa,
    ano,
    tipo,
    preco_litro_combustivel,
    km_por_litro,
    capacidade_bateria,
    autonomia_carga_cheia,
  } = req.body;
  const sql = `
        UPDATE Veiculo SET
            marca = ?, modelo = ?, placa = ?, ano = ?, tipo = ?,
            preco_litro_combustivel = ?, km_por_litro = ?, capacidade_bateria = ?, autonomia_carga_cheia = ?
        WHERE id_veiculo = ? AND id_motorista = ?
    `;
  const values = [
    marca,
    modelo,
    placa,
    ano,
    tipo,
    preco_litro_combustivel,
    km_por_litro,
    capacidade_bateria,
    autonomia_carga_cheia,
    id,
    uid,
  ];
  let connection;
  try {
    connection = await createConnection();
    const [result] = await connection.execute(sql, values);
    await connection.end();
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({
          error: "Veículo não encontrado ou não pertence a este utilizador.",
        });
    }
    res.json({ message: "Veículo atualizado com sucesso." });
  } catch (e) {
    console.error("Erro na rota PUT /api/vehicles/:id:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/vehicles/:id", async (req, res) => {
  const { uid } = req.user;
  const { id } = req.params;
  let connection;
  try {
    connection = await createConnection();
    const sql = "DELETE FROM Veiculo WHERE id_veiculo = ? AND id_motorista = ?";
    const [result] = await connection.execute(sql, [id, uid]);
    await connection.end();
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({
          error: "Veículo não encontrado ou não pertence a este utilizador.",
        });
    }
    res.status(204).send();
  } catch (e) {
    console.error("Erro na rota DELETE /api/vehicles/:id:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

// --- ROTAS DE CUSTOS FIXOS ---
app.get("/api/custofixo", async (req, res) => {
  const { uid } = req.user;
  let connection;
  try {
    connection = await createConnection();
    const [rows] = await connection.execute(
      "SELECT * FROM CustoFixo WHERE id_motorista = ?",
      [uid]
    );
    await connection.end();
    res.json(rows);
  } catch (e) {
    console.error("Erro na rota GET /api/custofixo:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/custofixo", async (req, res) => {
  const { uid } = req.user;
  const { descricao, valor, data_vencimento, tipo } = req.body;
  let connection;
  try {
    connection = await createConnection();
    const sql =
      "INSERT INTO CustoFixo (id_motorista, descricao, valor, data_vencimento, tipo) VALUES (?, ?, ?, ?, ?)";
    const [result] = await connection.execute(sql, [
      uid,
      descricao,
      valor,
      data_vencimento,
      tipo,
    ]);
    await connection.end();
    res.status(201).json({ id_custo: result.insertId, ...req.body });
  } catch (e) {
    console.error("Erro na rota POST /api/custofixo:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/custofixo/:id", async (req, res) => {
  const { uid } = req.user;
  const { id } = req.params;
  const { descricao, valor, data_vencimento, tipo } = req.body;
  let connection;
  try {
    connection = await createConnection();
    const sql =
      "UPDATE CustoFixo SET descricao = ?, valor = ?, data_vencimento = ?, tipo = ? WHERE id_custo = ? AND id_motorista = ?";
    const [result] = await connection.execute(sql, [
      descricao,
      valor,
      data_vencimento,
      tipo,
      id,
      uid,
    ]);
    await connection.end();
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({
          error: "Custo não encontrado ou não pertence a este utilizador.",
        });
    }
    res.json({ message: "Custo atualizado com sucesso." });
  } catch (e) {
    console.error("Erro na rota PUT /api/custofixo/:id:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/custofixo/:id", async (req, res) => {
  const { uid } = req.user;
  const { id } = req.params;
  let connection;
  try {
    connection = await createConnection();
    const sql = "DELETE FROM CustoFixo WHERE id_custo = ? AND id_motorista = ?";
    const [result] = await connection.execute(sql, [id, uid]);
    await connection.end();
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({
          error: "Custo não encontrado ou não pertence a este utilizador.",
        });
    }
    res.status(204).send();
  } catch (e) {
    console.error("Erro na rota DELETE /api/custofixo/:id:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

// --- ROTAS DE REGISTOS DIÁRIOS (LogDiario) ---
app.get("/api/logs", async (req, res) => {
  const { uid } = req.user;
  let connection;
  try {
    connection = await createConnection();
    const sql = `
            SELECT ld.* FROM LogDiario ld
            JOIN Veiculo v ON ld.id_veiculo = v.id_veiculo
            WHERE v.id_motorista = ?
            ORDER BY ld.data DESC
        `;
    const [rows] = await connection.execute(sql, [uid]);
    await connection.end();
    res.json(rows);
  } catch (e) {
    console.error("Erro na rota GET /api/logs:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/logs", async (req, res) => {
  const { uid } = req.user;
  const {
    id_veiculo,
    data,
    km_rodado,
    corridas,
    ganhos_uber,
    ganhos_99,
    gastos_extras,
  } = req.body;
  let connection;
  try {
    connection = await createConnection();
    const [vehicleCheck] = await connection.execute(
      "SELECT id_veiculo FROM Veiculo WHERE id_veiculo = ? AND id_motorista = ?",
      [id_veiculo, uid]
    );
    if (vehicleCheck.length === 0) {
      await connection.end();
      return res
        .status(403)
        .json({ error: "Este veículo não pertence ao utilizador." });
    }
    const columns =
      "id_veiculo, data, km_rodado, corridas, ganhos_uber, ganhos_99, gastos_extras";
    const placeholders = "?, ?, ?, ?, ?, ?, ?";
    const values = [
      id_veiculo,
      data,
      km_rodado,
      corridas,
      ganhos_uber,
      ganhos_99,
      gastos_extras,
    ];
    const onUpdate = `
            km_rodado = VALUES(km_rodado), corridas = VALUES(corridas), 
            ganhos_uber = VALUES(ganhos_uber), ganhos_99 = VALUES(ganhos_99), gastos_extras = VALUES(gastos_extras)
        `;
    const sql = `INSERT INTO LogDiario (${columns}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${onUpdate}`;
    await connection.execute(sql, values);
    await connection.end();
    res
      .status(201)
      .json({ message: "Registo diário guardado com sucesso.", ...req.body });
  } catch (e) {
    console.error("Erro na rota POST /api/logs:", e.message);
    if (connection) await connection.end();
    res.status(500).json({ error: e.message });
  }
});

// --- Iniciar o Servidor ---
app.listen(port, "0.0.0.0", () => {
  console.log(`Servidor DriverCosts a correr na porta ${port}`);
});
