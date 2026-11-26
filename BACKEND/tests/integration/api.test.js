process.env.JWT_SECRET = "test-secret";

jest.mock("../../src/db", () => ({ pool: { query: jest.fn() } }));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { pool } = require("../../src/db");
const app = require("../../src/app");

beforeEach(() => {
  pool.query.mockReset();
});

describe("Salud y metadatos", () => {
  test("GET /health responde ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  test("GET / identifica la API", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Atlas");
  });

  test("GET /openapi.json entrega la especificacion", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("object");
  });
});

describe("Roles", () => {
  const token = jwt.sign({ nombreUsuario: "qa" }, "test-secret");

  test("GET /roles lista los roles", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: "admin" }] });
    const res = await request(app).get("/roles");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test("GET /roles responde 500 si falla la base de datos", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    pool.query.mockRejectedValueOnce(new Error("db caida"));
    const res = await request(app).get("/roles");
    expect(res.status).toBe(500);
    expect(res.body.glosa).toBe("db caida");
    spy.mockRestore();
  });

  test("GET /roles/:id devuelve el rol", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: "admin" }] });
    const res = await request(app).get("/roles/1");
    expect(res.status).toBe(200);
    expect(res.body.nombre).toBe("admin");
  });

  test("GET /roles/:id inexistente da 404", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/roles/99");
    expect(res.status).toBe(404);
  });

  test("POST /roles crea el rol y registra auditoria con el usuario del token", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 3, nombre: "auditor" }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/roles")
      .set("Authorization", `Bearer ${token}`)
      .send({ nombre: "auditor" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(3);
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO auditoria"),
      ["qa", "ROLES_CREAR: creó rol auditor"]
    );
  });

  test("PUT /roles/:id inexistente da 404", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put("/roles/99").send({ nombre: "x" });
    expect(res.status).toBe(404);
  });

  test("PUT /roles/:id actualiza el rol", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, nombre: "nuevo" }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put("/roles/1").send({ nombre: "nuevo" });
    expect(res.status).toBe(200);
    expect(res.body.nombre).toBe("nuevo");
  });

  test("DELETE /roles/:id elimina el rol", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete("/roles/1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
  });

  test("DELETE /roles/:id inexistente da 404", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete("/roles/99");
    expect(res.status).toBe(404);
  });
});

describe("Login (incluye la latencia simulada de 4 s)", () => {
  test("usuario inexistente da 401", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/autenticacion/login")
      .send({ nombre_usuario: "nadie", password: "x" });
    expect(res.status).toBe(401);
  });

  test("contrasena incorrecta da 401", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, nombre_usuario: "ana", contrasena_hash: "correcta" }],
    });
    const res = await request(app)
      .post("/autenticacion/login")
      .send({ nombre_usuario: "ana", password: "incorrecta" });
    expect(res.status).toBe(401);
  });

  test("credenciales validas entregan un token con la empresa", async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 1, nombre_usuario: "ana", contrasena_hash: "correcta" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 5, empresa_id: 9 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/autenticacion/login")
      .send({ nombre_usuario: "ana", password: "correcta" });
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.token, "test-secret");
    expect(payload.empresaId).toBe(9);
    expect(payload.nombreUsuario).toBe("ana");
  });
});
