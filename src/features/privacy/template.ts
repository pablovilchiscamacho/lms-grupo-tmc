/** Texto base del aviso (Ley Federal de Protección de Datos Personales en Posesión de los Particulares).
 *  {{empresa}} y {{fecha}} se llenan solos; lo que va entre [CORCHETES] hay que completarlo antes de publicar.
 *  Debe revisarlo el área Legal de la empresa. */
export const PRIVACY_TEMPLATE_TITLE = "Aviso de privacidad para colaboradores";

export const PRIVACY_TEMPLATE = `## Responsable
{{empresa}}, con domicilio en [DOMICILIO], es responsable del tratamiento de los datos personales que se usan en esta plataforma de capacitación.

## Datos que usamos
- Identificación: nombre, número de empleado, correo electrónico y usuario.
- Laborales: empresa, sucursal, departamento, puesto y jefe directo.
- De capacitación: cursos asignados, avance, respuestas y calificaciones de exámenes, constancias y fechas.
- Técnicos de acceso: fecha y hora de ingreso, dirección IP y tipo de navegador, para seguridad de la cuenta.
No pedimos datos personales sensibles.

## Para qué los usamos
- Asignar, impartir y dar seguimiento a la capacitación que requiere tu puesto.
- Calificar evaluaciones y emitir constancias.
- Permitir que un tercero verifique la autenticidad de una constancia que tú le presentes.
- Conservar evidencia de la capacitación ante auditorías y autoridades laborales.
- Proteger la plataforma y tu cuenta.
No usamos tus datos para publicidad ni los vendemos.

## Quién puede ver tus datos
- Personal autorizado de Capital Humano y Capacitación, y tu jefe directo, solo en lo que corresponde a su área.
- Proveedores tecnológicos que alojan la plataforma y envían los avisos (Supabase, Vercel y Resend, con servidores en Estados Unidos), que solo tratan los datos por cuenta de {{empresa}}.
- Al verificar una constancia con su código QR solo se muestra tu nombre, el curso, la empresa, las fechas y la calificación.

## Cuánto tiempo los conservamos
Mientras dure tu relación laboral y después por el plazo que exijan las leyes laborales y de seguridad e higiene para comprobar la capacitación. Después se eliminan o se anonimizan.

## Tus derechos
Puedes pedir acceso, rectificación, cancelación u oposición al tratamiento de tus datos (derechos ARCO), o revocar tu consentimiento, escribiendo a [CORREO DE CONTACTO] con tu nombre, número de empleado y lo que solicitas. Te responderemos en un plazo máximo de 20 días hábiles. Si consideras que tu derecho no fue atendido, puedes acudir ante la autoridad competente en protección de datos personales.

## Cookies
La plataforma solo usa cookies técnicas necesarias para mantener tu sesión iniciada. No usa cookies de publicidad ni de rastreo.

## Cambios a este aviso
Si el aviso cambia, te lo mostraremos al ingresar a la plataforma y te pediremos aceptarlo de nuevo.

Última actualización: {{fecha}}.`;
