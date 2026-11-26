process.env.JWT_SECRET = "test-secret";

jest.mock("../../src/db", () => ({ pool: { query: jest.fn() } }));

const request = require("supertest");
const { pool } = require("../../src/db");
const app = require("../../src/app");

let errorSpy;

beforeEach(() => {
  pool.query.mockReset();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

const sinMensaje = { toString: () => "fallo sin mensaje" };

describe("Roles: errores de base de datos", () => {
  test("POST /roles responde 500 si falla el INSERT", async () => {
    pool.query.mockRejectedValueOnce(new Error("insert fallido"));
    const res = await request(app).post("/roles").send({ nombre: "x" });
    expect(res.status).toBe(500);
    expect(res.body.glosa).toBe("insert fallido");
  });

  test("GET /roles/:id responde 500 si falla la consulta", async () => {
    pool.query.mockRejectedValueOnce(sinMensaje);
    const res = await request(app).get("/roles/1");
    expect(res.status).toBe(500);
    expect(res.body.glosa).toBe("fallo sin mensaje");
  });

  test("PUT /roles/:id responde 500 si falla el UPDATE", async () => {
    pool.query.mockRejectedValueOnce(new Error("update fallido"));
    const res = await request(app).put("/roles/1").send({ nombre: "x" });
    expect(res.status).toBe(500);
  });

  test("DELETE /roles/:id responde 500 si falla el DELETE", async () => {
    pool.query.mockRejectedValueOnce(new Error("delete fallido"));
    const res = await request(app).delete("/roles/1");
    expect(res.status).toBe(500);
  });
});

describe("Roles: token invalido", () => {
  test("un token invalido registra la auditoria sin usuario", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 4, nombre: "x" }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/roles")
      .set("Authorization", "Bearer token-invalido")
      .send({ nombre: "x" });
    expect(res.status).toBe(201);
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO auditoria"),
      [null, "ROLES_CREAR: creó rol x"]
    );
  });
});

describe("Login: casos adicionales", () => {
  test("usuario sin empresa recibe token con empresa nula", async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 2, nombre_usuario: "luis", contrasena_hash: "ok" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/autenticacion/login")
      .send({ nombre_usuario: "luis", password: "ok" });
    expect(res.status).toBe(200);
    const payload = JSON.parse(
      Buffer.from(res.body.token.split(".")[1], "base64").toString()
    );
    expect(payload.empresaId).toBeNull();
  });

  test("un error de base de datos en login da 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("sin conexion"));
    const res = await request(app)
      .post("/autenticacion/login")
      .send({ nombre_usuario: "ana", password: "x" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Error en login");
  });
});
