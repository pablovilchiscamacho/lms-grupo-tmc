import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { errorOf, freshDb, q } from "./harness";
import { ID, seed } from "./fixtures";

let db: PGlite;
const T = { uid: ID.trainer, aal: "aal2" as const };
const one = async <R,>(p: Promise<R[]>) => (await p)[0];

let course: string;
let v1: string;
let lessonA: string;
let lessonB: string;
let lessonVideo: string;
let fileVideo: string;
let enrollOps1: string;

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
});

describe("Cursos y versiones", () => {
  it("el Admin de Capacitación crea un curso con versión 1 en borrador y un módulo", async () => {
    course = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id",
      [{ code: "SEG-001", title: "Seguridad Operativa", owner_company_id: null }]))).id;
    const v = await one(q<{ id: string; status: string; version_number: number }>(db, T,
      "select id, status, version_number from public.course_versions where course_id = $1", [course]));
    v1 = v.id;
    expect(v).toMatchObject({ status: "draft", version_number: 1 });
  });

  it("RH (sin permisos de cursos) no puede crear cursos ni verlos", async () => {
    expect(await errorOf(q(db, { uid: ID.hrEa, aal: "aal2" }, "select public.create_course($1)", [{ code: "X-1", title: "No permitido" }])))
      .toBe("FORBIDDEN");
    expect(await q(db, { uid: ID.hrEa, aal: "aal2" }, "select id from public.courses")).toEqual([]);
  });

  it("arma lecciones y contenido; el reporte de publicación las valida", async () => {
    const mod = await one(q<{ id: string }>(db, T, "select id from public.course_modules where course_version_id = $1", [v1]));
    const issues = await one(q<{ i: string[] }>(db, T, "select public.version_publish_issues($1) as i", [v1]));
    expect(issues.i).toContain("El módulo «Módulo 1» no tiene lecciones.");

    lessonA = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position, completion_rule) values ($1, 'Bienvenida', 1, 'manual') returning id", [mod.id]))).id;
    lessonB = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position, completion_rule, min_seconds) values ($1, 'Reglamento', 2, 'min_time', 30) returning id", [mod.id]))).id;
    lessonVideo = (await one(q<{ id: string }>(db, T, "insert into public.lessons (module_id, title, position, completion_rule, is_required) values ($1, 'Video', 3, 'video_percent', false) returning id", [mod.id]))).id;
    await q(db, T, "insert into public.lesson_contents (lesson_id, type, body_html) values ($1, 'text', '<p>Hola</p>'), ($2, 'text', '<p>Reglas</p>')", [lessonA, lessonB]);
    fileVideo = (await one(db.query<{ id: string }>(
      `insert into public.files (bucket, storage_path, original_name, extension, mime_type, size_bytes, status, course_id, media_duration_s)
       values ('course-content', $1::text || '/v.mp4', 'v.mp4', 'mp4', 'video/mp4', 1000, 'verified', $1::uuid, 600) returning id`, [course]).then((r) => r.rows))).id;
    await q(db, T, "insert into public.lesson_contents (lesson_id, type, file_id) values ($1, 'video', $2)", [lessonVideo, fileVideo]);
    expect((await one(q<{ i: string[] }>(db, T, "select public.version_publish_issues($1) as i", [v1]))).i).toEqual([]);
  });

  it("un empleado no ve el curso antes de que se lo asignen", async () => {
    expect(await q(db, { uid: ID.empOps1 }, "select id from public.courses")).toEqual([]);
    expect(await q(db, { uid: ID.empOps1 }, "select id from public.lessons")).toEqual([]);
  });

  it("publica; después el contenido de esa versión ya no se puede tocar", async () => {
    await q(db, T, "select public.publish_course_version($1, 'Primera versión')", [course]);
    const c = await one(db.query<{ status: string; current_version_id: string }>("select status, current_version_id from public.courses where id = $1", [course]).then((r) => r.rows));
    expect(c).toEqual({ status: "published", current_version_id: v1 });
    expect(await errorOf(q(db, T, "update public.lessons set title = 'Otro' where id = $1", [lessonA]))).toBe("VERSION_LOCKED");
    expect(await errorOf(q(db, T, "update public.course_versions set passing_score = 50 where id = $1", [v1]))).toBe("VERSION_LOCKED");
    expect(await errorOf(q(db, T, "delete from public.lesson_contents where lesson_id = $1", [lessonA]))).toBe("VERSION_LOCKED");
  });

  it("la máquina de estados rechaza transiciones inválidas", async () => {
    expect(await errorOf(q(db, T, "select public.set_course_status($1, 'draft')", [course]))).toBe("INVALID_TRANSITION");
  });
});

describe("Asignación y avance", () => {
  it("asigna directamente; RH sin permiso de asignar no puede", async () => {
    const r = await one(q<{ r: { created: number } }>(db, T, "select public.admin_enroll($1, $2) as r", [course, [ID.empOps1, ID.empTmc]]));
    expect(r.r.created).toBe(2);
    expect(await errorOf(q(db, { uid: ID.hrEa, aal: "aal2" }, "select public.admin_enroll($1, $2)", [course, [ID.empVta]]))).toBe("FORBIDDEN");
    const again = await one(q<{ r: { skipped: number } }>(db, T, "select public.admin_enroll($1, $2) as r", [course, [ID.empOps1]]));
    expect(again.r.skipped).toBe(1);
    enrollOps1 = (await one(db.query<{ id: string }>("select id from public.enrollments where user_id = $1", [ID.empOps1]).then((x) => x.rows))).id;
  });

  it("el inscrito ve el curso y sus lecciones; quien no está inscrito, no", async () => {
    expect((await q(db, { uid: ID.empOps1 }, "select id from public.lessons")).length).toBe(3);
    expect(await q(db, { uid: ID.empVta }, "select id from public.lessons")).toEqual([]);
  });

  it("curso secuencial: no puede abrir la lección 2 sin completar la 1", async () => {
    expect(await errorOf(q(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'open')", [lessonB]))).toBe("LESSON_LOCKED");
  });

  it("abrir inicia el curso (fija la versión); el botón valida la regla en el servidor", async () => {
    await q(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'open')", [lessonA]);
    const e = await one(db.query<{ course_version_id: string; progress_status: string }>("select course_version_id, progress_status from public.enrollments where id = $1", [enrollOps1]).then((r) => r.rows));
    expect(e).toEqual({ course_version_id: v1, progress_status: "in_progress" });
    await q(db, { uid: ID.empOps1 }, "select public.complete_lesson($1)", [lessonA]);
    await q(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'open')", [lessonB]);
    expect(await errorOf(q(db, { uid: ID.empOps1 }, "select public.complete_lesson($1)", [lessonB]))).toBe("LESSON_RULE_NOT_MET");
  });

  it("el tiempo lo cuenta el servidor (máximo 60 s por latido) y completa solo al cumplir la regla", async () => {
    await db.query("update public.lesson_progress set last_heartbeat_at = now() - interval '45 seconds' where lesson_id = $1", [lessonB]);
    const r = await one(q<{ r: { status: string; seconds: number } }>(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'heartbeat') as r", [lessonB]));
    expect(r.r).toMatchObject({ status: "completed", seconds: 45 });
    await db.query("update public.lesson_progress set last_heartbeat_at = now() - interval '1 hour' where lesson_id = $1", [lessonB]);
    const r2 = await one(q<{ r: { seconds: number } }>(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'heartbeat') as r", [lessonB]));
    expect(r2.r.seconds).toBe(105);
    const e = await one(db.query<{ progress_pct: string; progress_status: string }>("select progress_pct, progress_status from public.enrollments where id = $1", [enrollOps1]).then((x) => x.rows));
    expect(e).toEqual({ progress_pct: "100.00", progress_status: "completed" }); // el video es opcional
  });

  it("el % de video reportado se acota al tiempo real", async () => {
    await q(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'open')", [lessonVideo]);
    await db.query("update public.lesson_progress set last_heartbeat_at = now() - interval '60 seconds' where lesson_id = $1", [lessonVideo]);
    const r = await one(q<{ r: { video_pct: string } }>(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'heartbeat', $2) as r", [lessonVideo, { video_pct: 95 }]));
    expect(Number(r.r.video_pct)).toBeCloseTo(18.75, 2); // (60 + 30) s × 1.25 / 600 s
  });

  it("el empleado no puede escribir su avance ni borrar su inscripción", async () => {
    expect(await errorOf(q(db, { uid: ID.empOps1 }, "update public.lesson_progress set status = 'completed'"))).toMatch(/permission denied/);
    expect(await errorOf(q(db, { uid: ID.empOps1 }, "update public.enrollments set progress_pct = 100"))).toMatch(/permission denied/);
    expect(await errorOf(db.query("delete from public.enrollments where id = $1", [enrollOps1]))).toBe("ACADEMIC_RECORD_PROTECTED");
  });

  it("el jefe ve el avance de su equipo y no el de otra empresa", async () => {
    const rows = await q<{ user_id: string }>(db, { uid: ID.mgrOps }, "select user_id from public.enrollments");
    expect(rows.map((r) => r.user_id)).toEqual([ID.empOps1]);
  });
});

describe("Páginas de un PDF", () => {
  it("cuenta las páginas vistas y no acepta marcar todas de golpe", async () => {
    const mod = await one(q<{ id: string }>(db, T, "select m.id from public.course_modules m join public.course_versions v on v.id = m.course_version_id where v.course_id = $1 and v.status = 'published'", [course]));
    // Se agrega directamente (como sistema) una lección PDF de 10 páginas a la versión publicada para la prueba.
    await db.query("select set_config('app.bypass_lock', 'on', false)");
    const pdf = (await one(db.query<{ id: string }>(`insert into public.files (bucket, storage_path, original_name, extension, mime_type, size_bytes, status, course_id, page_count)
      values ('course-content', $1::text || '/p.pdf', 'p.pdf', 'pdf', 'application/pdf', 10, 'verified', $1::uuid, 10) returning id`, [course]).then((r) => r.rows))).id;
    const les = (await one(db.query<{ id: string }>("insert into public.lessons (module_id, title, position, completion_rule, is_required) values ($1, 'Presentación', 4, 'all_pages', false) returning id", [mod.id]).then((r) => r.rows))).id;
    await db.query("insert into public.lesson_contents (lesson_id, type, file_id) values ($1, 'pdf', $2)", [les, pdf]);
    await db.query("select set_config('app.bypass_lock', 'off', false)");

    const first = await one(q<{ r: { pages: number } }>(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'open', $2) as r", [les, { pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }]));
    expect(first.r.pages).toBe(3); // sin tiempo transcurrido solo se aceptan 3
    await db.query("update public.lesson_progress set last_heartbeat_at = now() - interval '20 seconds' where lesson_id = $1", [les]);
    const second = await one(q<{ r: { pages: number; status: string } }>(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'heartbeat', $2) as r", [les, { pages: [4, 5, 6, 7, 8, 9, 10, 99] }]));
    expect(second.r).toMatchObject({ pages: 10, status: "completed" }); // 20 s → hasta 13 páginas; la 99 no existe
  });
});

describe("Versión nueva sin alterar el historial", () => {
  let v2: string;
  it("editar un curso publicado crea la versión 2 (copia) y la versión 1 sigue igual", async () => {
    v2 = (await one(q<{ id: string }>(db, T, "select public.create_draft_version($1) as id", [course]))).id;
    expect(v2).not.toBe(v1);
    const counts = await one(db.query<{ a: number; b: number }>(
      `select (select count(*) from public.lessons l join public.course_modules m on m.id = l.module_id where m.course_version_id = $1)::int a,
              (select count(*) from public.lessons l join public.course_modules m on m.id = l.module_id where m.course_version_id = $2)::int b`, [v1, v2]).then((r) => r.rows));
    expect(counts).toEqual({ a: 4, b: 4 });
    // Los archivos se reutilizan: la versión 2 apunta a los mismos (video y PDF), no a copias.
    const files = await db.query("select count(distinct c.file_id)::int n, count(*)::int refs from public.lesson_contents c where c.file_id is not null");
    expect(files.rows[0]).toEqual({ n: 2, refs: 4 });
    await q(db, T, "update public.lessons set title = 'Reglamento 2026' where module_id in (select id from public.course_modules where course_version_id = $1) and position = 2", [v2]);
    await q(db, T, "select public.publish_course_version($1, 'Reglamento actualizado')", [course]);
  });

  it("quien ya empezó sigue en la versión 1; quien no ha empezado toma la 2", async () => {
    expect((await q<{ title: string }>(db, { uid: ID.empOps1 }, "select title from public.lessons where id = $1", [lessonB]))[0].title).toBe("Reglamento");
    const v2Lesson = await one(db.query<{ id: string }>("select l.id from public.lessons l join public.course_modules m on m.id = l.module_id where m.course_version_id = $1 and l.position = 1", [v2]).then((r) => r.rows));
    await q(db, { uid: ID.empTmc }, "select public.track_lesson($1, 'open')", [v2Lesson.id]);
    const e = await one(db.query<{ course_version_id: string }>("select course_version_id from public.enrollments where user_id = $1", [ID.empTmc]).then((r) => r.rows));
    expect(e.course_version_id).toBe(v2);
    expect(await errorOf(q(db, { uid: ID.empTmc }, "select public.track_lesson($1, 'open')", [lessonA]))).toBe("NOT_ENROLLED");
  });
});

describe("Archivos", () => {
  it("valida tipo y tamaño, y reutiliza archivos idénticos", async () => {
    expect(await errorOf(q(db, T, "select public.file_prepare_upload($1)", [{ course_id: course, name: "virus.exe", extension: "exe", size_bytes: 10 }])))
      .toBe("FILE_TYPE_NOT_ALLOWED");
    expect(await errorOf(q(db, T, "select public.file_prepare_upload($1)", [{ course_id: course, name: "x.pdf", extension: "pdf", size_bytes: 300 * 1024 * 1024 }])))
      .toBe("FILE_TOO_LARGE");
    const sha = "a".repeat(64);
    await db.query("update public.files set sha256 = $1 where id = $2", [sha, fileVideo]);
    const r = await one(q<{ r: { existing_file_id?: string; file_id?: string } }>(db, T, "select public.file_prepare_upload($1) as r",
      [{ course_id: course, name: "otro.mp4", extension: "mp4", size_bytes: 1000, sha256: sha }]));
    expect(r.r.existing_file_id).toBe(fileVideo);
    const r2 = await one(q<{ r: { file_id: string; path: string } }>(db, T, "select public.file_prepare_upload($1) as r",
      [{ course_id: course, name: "Presentación.pptx", extension: "pptx", size_bytes: 5000 }]));
    expect(r2.r.path).toMatch(new RegExp(`^${course}/[0-9a-f-]{36}\\.pptx$`));
    const f = await one(db.query<{ status: string; conversion_status: string }>("select status, conversion_status from public.files where id = $1", [r2.r.file_id]).then((x) => x.rows));
    expect(f).toEqual({ status: "pending_upload", conversion_status: "pending" });
  });

  it("solo quien gestiona el curso o está inscrito puede abrir un archivo", async () => {
    expect((await one(q<{ r: { bucket: string } }>(db, T, "select public.file_access($1) as r", [fileVideo]))).r.bucket).toBe("course-content");
    expect((await one(q<{ r: { bucket: string } }>(db, { uid: ID.empOps1 }, "select public.file_access($1) as r", [fileVideo]))).r.bucket).toBe("course-content");
    expect(await errorOf(q(db, { uid: ID.empVta }, "select public.file_access($1)", [fileVideo]))).toBe("FORBIDDEN");
  });

  it("los pasos de servidor no se pueden llamar desde la app", async () => {
    expect(await errorOf(q(db, T, "select public.file_finalize($1, '{\"ok\":true}')", [fileVideo]))).toMatch(/permission denied/);
  });
});

describe("Estados y borrado", () => {
  it("un curso suspendido no se puede tomar", async () => {
    await q(db, T, "select public.set_course_status($1, 'suspended', 'Revisión')", [course]);
    expect(await errorOf(q(db, { uid: ID.empOps1 }, "select public.track_lesson($1, 'open')", [lessonA]))).toBe("COURSE_SUSPENDED");
    await q(db, T, "select public.set_course_status($1, 'published')", [course]);
  });

  it("no se borra un curso con historial; uno sin uso sí", async () => {
    await db.query(`insert into public.role_permissions (role_id, permission_key) select id, 'courses.delete' from public.roles where key = 'training_admin'`);
    expect(await errorOf(q(db, T, "select public.delete_course($1)", [course]))).toBe("COURSE_HAS_HISTORY");
    const tmp = (await one(q<{ id: string }>(db, T, "select public.create_course($1) as id", [{ code: "TMP-1", title: "Curso temporal" }]))).id;
    await q(db, T, "select public.delete_course($1)", [tmp]);
    expect((await db.query("select 1 from public.courses where id = $1", [tmp])).rows).toEqual([]);
  });

  it("duplicar crea un borrador nuevo con el mismo contenido", async () => {
    const dup = (await one(q<{ id: string }>(db, T, "select public.duplicate_course($1, 'SEG-002', 'Seguridad Operativa (copia)') as id", [course]))).id;
    const n = await one(db.query<{ n: number }>("select count(*)::int n from public.lessons l join public.course_modules m on m.id = l.module_id join public.course_versions v on v.id = m.course_version_id where v.course_id = $1", [dup]).then((r) => r.rows));
    expect(n.n).toBe(4);
  });
});
