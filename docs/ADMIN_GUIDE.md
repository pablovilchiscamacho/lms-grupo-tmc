# Guía del administrador

> Cubre lo disponible en la **Fase 1**: acceso, usuarios, roles, organización y auditoría. Se amplía en cada fase.

## Entrar
- Entra con tu correo y contraseña. Los roles administrativos piden además un **código de verificación** (doble factor). La primera vez escaneas un código QR con Google Authenticator o Microsoft Authenticator.
- Arriba a la derecha, el menú de tu nombre cambia entre **Administración** y **Mi capacitación** (tu vista como empleado).

## Organización (Personas → Organización)
1. **Empresas**: nombre, abreviatura (EA, TMC, TMCa) y zona horaria. La abreviatura es la que se escribe en la importación.
2. **Sucursales**, **Departamentos** y **Puestos**: siempre pertenecen a una empresa. La *clave* (QRO, OPS, OPER…) también sirve en la importación.
3. Nada se borra: se **desactiva**. Lo inactivo deja de aparecer en los formularios, pero el historial se conserva.

## Usuarios
### Alta individual (Usuarios → Nuevo usuario)
- **Con correo corporativo**: elige *Invitación por correo* (recibe un enlace para definir su contraseña) o *Contraseña temporal*.
- **Sin correo** (por ejemplo, operadores): desmarca "Tiene correo corporativo" y captura el **número de empleado** o un **usuario**. Se crea con contraseña temporal, que se muestra **una sola vez**. Entrégala en persona; la persona la cambia al entrar.
- El **jefe directo** define quién lo ve como manager.

### Importación masiva (Usuarios → Importar)
1. Descarga la **plantilla**, llénala y súbela (.xlsx o .csv).
2. El sistema valida **antes** de crear: ✓ válidos, ⚠ con errores y ❌ duplicados. Usa **Corregir** en una fila y luego **Volver a validar**.
3. Elige cómo recibirán su acceso y pulsa **Importar**. Al terminar, descarga el archivo de **accesos temporales** y entrégalo de forma segura; no se puede volver a consultar.
4. Los jefes que vienen en el mismo archivo se ligan automáticamente al final.

### Ficha del usuario
- **Datos**: edita la información. Si cambias el correo, cambia también su forma de entrar.
- **Roles** (solo Super Admin): asigna un rol con su **alcance**. Por ejemplo, *Jefe / Manager* con alcance *Su línea de reporte*, o *Administrador de RH* con alcance *Empresa: EA*.
- **Acceso**: envía un enlace de restablecimiento o asigna una contraseña temporal.
- **Estado**: Activo, Inactivo, Suspendido o Baja, siempre con motivo. Al desactivar, la persona pierde el acceso de inmediato y su historial se conserva.
- **Historial de cambios**: quién cambió qué y cuándo.

## Roles disponibles

| Rol | Para quién | Puede |
|---|---|---|
| Super Admin | Dueño del sistema | Todo, incluidos los roles |
| Admin de Capacitación | Área de capacitación | Cursos, exámenes, asignaciones, calificar y reportes (fases 2 a 7) |
| Admin de RH | Recursos Humanos | Alta, edición, baja e importación de usuarios y reportes, dentro de su alcance |
| Jefe / Manager | Jefaturas | Consultar a su equipo y su cumplimiento |
| Instructor | Quien imparte | Crear contenido y calificar sus cursos (fases 2 y 3) |
| Dirección | Directivos | Tablero ejecutivo (Fase 5) |

Reglas de seguridad: nadie puede cambiarse su propio rol o estado; solo un Super Admin puede tocar cuentas administrativas; siempre debe quedar al menos un Super Admin activo.

## Auditoría (Control → Auditoría)
Registro de solo lectura de accesos, altas, cambios, roles y estados, con autor, fecha, IP y valores anteriores y nuevos. Nadie, ni el Super Admin, puede editarlo o borrarlo.
