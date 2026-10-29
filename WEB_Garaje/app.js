"use strict";

const CAPACIDAD = 100;
const DIRECCION_WS = `ws://${window.location.hostname || "localhost"}:1880/ws/garaje`;
let socket = null;
let reconnectTimer = null;
let valorPendiente = null;
let valorEnCola = null;
let temporizadorEnvio = null;

function programarReconectar() {
  if (reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    conectar();
  }, 1500);
}

function mostrarConexion(conectado) {
  const indicador = document.getElementById("estado-conexion");
  document.getElementById("texto-conexion").textContent = conectado ? "Conectado" : "Desconectado";
  indicador.classList.toggle("conectado", conectado);
  indicador.classList.remove("error");
}

function mostrarRespuestaEnvio(texto, estado = "") {
  const respuesta = document.getElementById("respuesta-envio");
  if (!respuesta) return;
  respuesta.textContent = texto;
  respuesta.className = `respuesta-envio${estado ? ` ${estado}` : ""}`;
}

function guardarValorForzado(valor) {
  try {
    localStorage.setItem("garaje-valor-forzado", String(valor));
  } catch {
    // La confirmación del PLC no depende del almacenamiento local.
  }
}

function enviarValorForzado(valor) {
  if (valorPendiente !== null) {
    valorEnCola = valor;
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    valorEnCola = valor;
    mostrarRespuestaEnvio("Valor guardado; se enviará al conectar con el PLC.");
    return;
  }

  valorPendiente = valor;
  valorEnCola = null;
  socket.send(JSON.stringify({ forzar: valor }));
  mostrarRespuestaEnvio(`Enviando ${valor} al PLC…`);
}

function programarEnvioForzado(valor) {
  valorEnCola = valor;
  if (temporizadorEnvio !== null) window.clearTimeout(temporizadorEnvio);
  mostrarRespuestaEnvio(`Se enviará ${valor} automáticamente al terminar el cambio.`);
  temporizadorEnvio = window.setTimeout(() => {
    temporizadorEnvio = null;
    if (valorEnCola === null || valorPendiente !== null) return;
    const siguienteValor = valorEnCola;
    valorEnCola = null;
    enviarValorForzado(siguienteValor);
  }, 600);
}

function plazasDesde(mensaje) {
  if (typeof mensaje === "number" && Number.isFinite(mensaje)) return mensaje;

  if (typeof mensaje === "string") {
    const texto = mensaje.trim();
    if (texto !== "" && Number.isFinite(Number(texto))) return Number(texto);
    try {
      return plazasDesde(JSON.parse(texto));
    } catch {
      return null;
    }
  }

  if (mensaje && typeof mensaje === "object") {
    for (const nombre of ["ocupadas", "plazasOcupadas", "occupied", "payload"]) {
      if (Object.hasOwn(mensaje, nombre)) {
        const valor = plazasDesde(mensaje[nombre]);
        if (valor !== null) return valor;
      }
    }
  }

  return null;
}

function mostrarOcupacion(valor, salidasPLC = null) {
  const ocupadas = Math.max(0, Math.min(CAPACIDAD, Math.round(valor)));
  const libres = CAPACIDAD - ocupadas;
  const colorCalculado = ocupadas === CAPACIDAD ? "roja" : ocupadas >= 90 ? "ambar" : "verde";
  const usaSalidasPLC = salidasPLC && ["verde", "ambar", "rojo"].some((color) => typeof salidasPLC[color] === "boolean");
  const luces = usaSalidasPLC
    ? { verde: salidasPLC.verde === true, ambar: salidasPLC.ambar === true, roja: salidasPLC.rojo === true }
    : { verde: colorCalculado === "verde", ambar: colorCalculado === "ambar", roja: colorCalculado === "roja" };
  const activas = Object.keys(luces).filter((color) => luces[color]);
  const color = activas.length === 1 ? activas[0] : colorCalculado;
  const estados = { verde: "Disponible", ambar: "Casi completo", roja: "Completo" };
  const estado = usaSalidasPLC && activas.length === 0
    ? "Sin señal de semáforo"
    : usaSalidasPLC && activas.length > 1
      ? "Señales simultáneas"
      : estados[color];

  document.getElementById("ocupadas").textContent = ocupadas;
  document.getElementById("libres").textContent = libres;
  document.getElementById("porcentaje").textContent = `${ocupadas} % de ocupación`;
  document.getElementById("barra-valor").style.width = `${ocupadas}%`;
  document.getElementById("barra-valor").style.backgroundColor = `var(--${color === "roja" ? "rojo" : color})`;
  document.getElementById("estado-semaforo").textContent = estado;

  for (const colorLuz of ["verde", "ambar", "roja"]) {
    document.getElementById(`luz-${colorLuz}`).classList.toggle("activa", luces[colorLuz]);
  }

  for (const plaza of document.querySelectorAll(".plaza")) {
    const ocupada = Number(plaza.dataset.numero) <= ocupadas;
    plaza.classList.toggle("ocupada", ocupada);
    plaza.classList.remove("sin-datos");
    plaza.setAttribute("aria-label", `Plaza ${plaza.dataset.numero}: ${ocupada ? "ocupada" : "libre"}`);
  }

  const hora = new Date().toLocaleTimeString("es-ES");
  document.getElementById("actualizacion").textContent = `Última actualización de datos: ${hora}`;
}

function crearPlazas() {
  const rejilla = document.getElementById("rejilla-plazas");
  if (!rejilla) return;

  for (let numero = 1; numero <= CAPACIDAD; numero += 1) {
    const plaza = document.createElement("div");
    plaza.className = "plaza sin-datos";
    plaza.textContent = String(numero).padStart(2, "0");
    plaza.dataset.numero = numero;
    plaza.setAttribute("role", "listitem");
    plaza.setAttribute("aria-label", `Plaza ${numero}: sin datos`);
    rejilla.appendChild(plaza);
  }
}

function conectar() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  mostrarConexion(false);

  try {
    const conexion = new WebSocket(DIRECCION_WS);
    socket = conexion;

    conexion.addEventListener("open", () => {
      if (socket === conexion) {
        mostrarConexion(true);
        conexion.send(JSON.stringify({ leer: true }));
        if (document.body.dataset.pagina === "control" && valorEnCola !== null && valorPendiente === null) {
          if (temporizadorEnvio !== null) {
            window.clearTimeout(temporizadorEnvio);
            temporizadorEnvio = null;
          }
          const siguienteValor = valorEnCola;
          valorEnCola = null;
          enviarValorForzado(siguienteValor);
        }
      }
    });

    conexion.addEventListener("message", (evento) => {
      if (socket !== conexion) return;
      let datos = evento.data;
      if (typeof datos === "string") {
        try {
          datos = JSON.parse(datos);
        } catch {
          return;
        }
      }
      const valor = plazasDesde(datos);
      if (valor === null) {
        if (document.body.dataset.pagina === "control" && datos.error === "PLC_READBACK_TIMEOUT") {
          mostrarRespuestaEnvio("El PLC no confirmó la lectura de PV. No se pulsó LD; revisa DB2 y su acceso absoluto.", "error");
          valorPendiente = null;
          valorEnCola = null;
        }
        return;
      }
      if (document.body.dataset.pagina === "monitor") {
        mostrarOcupacion(valor, datos);
      } else if (datos.forzado_confirmado === true && valorPendiente === valor) {
        document.getElementById("valor-forzado").value = valor;
        document.getElementById("deslizador").value = valor;
        guardarValorForzado(valor);
        mostrarRespuestaEnvio(`PLC confirmó el valor: ${valor} plazas ocupadas.`, "ok");
        valorPendiente = null;
        if (valorEnCola !== null && temporizadorEnvio === null) {
          const siguienteValor = valorEnCola;
          valorEnCola = null;
          enviarValorForzado(siguienteValor);
        }
      }
    });

    conexion.addEventListener("error", () => {
      if (socket === conexion) mostrarConexion(false);
    });

    conexion.addEventListener("close", () => {
      if (socket === conexion) {
        socket = null;
        mostrarConexion(false);
        if (valorPendiente !== null) {
          if (valorEnCola === null) valorEnCola = valorPendiente;
          valorPendiente = null;
        }
        programarReconectar();
      }
    });
  } catch {
    socket = null;
    mostrarConexion(false);
    programarReconectar();
  }
}

function iniciarConexion() {
  conectar();
}

function iniciarMonitor() {
  const reloj = document.getElementById("reloj");
  const actualizarReloj = () => {
    reloj.textContent = new Date().toLocaleString("es-ES", {
      weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  };
  actualizarReloj();
  window.setInterval(actualizarReloj, 1000);
}

function iniciarControl() {
  const entrada = document.getElementById("valor-forzado");
  const deslizador = document.getElementById("deslizador");
  const respuesta = document.getElementById("respuesta-envio");

  function leerValorGuardado() {
    try {
      const guardado = localStorage.getItem("garaje-valor-forzado");
      const valor = Number(guardado);
      if (guardado !== null && Number.isInteger(valor) && valor >= 0 && valor <= CAPACIDAD) return valor;
    } catch {
      return 73;
    }
    return 73;
  }

  function guardarValor(valor) {
    try {
      localStorage.setItem("garaje-valor-forzado", String(valor));
    } catch {
      // El control sigue funcionando aunque el almacenamiento esté deshabilitado.
    }
  }

  function actualizarValor(valor) {
    entrada.value = valor;
    deslizador.value = valor;
    guardarValor(Number(valor));
  }

  actualizarValor(leerValorGuardado());

  entrada.addEventListener("input", () => {
    const valor = Math.max(0, Math.min(CAPACIDAD, Number(entrada.value) || 0));
    actualizarValor(valor);
    programarEnvioForzado(valor);
  });
  deslizador.addEventListener("input", () => {
    const valor = Number(deslizador.value);
    actualizarValor(valor);
    programarEnvioForzado(valor);
  });

  document.getElementById("form-forzar").addEventListener("submit", (evento) => {
    evento.preventDefault();
    const valor = Number(entrada.value);
    if (!Number.isInteger(valor) || valor < 0 || valor > CAPACIDAD) {
      respuesta.textContent = "El valor debe ser un número entero entre 0 y 100.";
      respuesta.className = "respuesta-envio error";
      return;
    }
    programarEnvioForzado(valor);
  });

  document.getElementById("boton-reset").addEventListener("click", () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      mostrarRespuestaEnvio("Node-RED está desconectado; no se envió el reset.", "error");
      return;
    }
    socket.send(JSON.stringify({ reset: true }));
    mostrarRespuestaEnvio("Señal de reset enviada al PLC.");
  });
}

if (document.body.dataset.pagina === "monitor") {
  const rejilla = document.getElementById("rejilla-plazas");
  for (let numero = 1; numero <= CAPACIDAD; numero += 1) {
    const plaza = document.createElement("div");
    plaza.className = "plaza sin-datos";
    plaza.textContent = String(numero).padStart(2, "0");
    plaza.dataset.numero = numero;
    plaza.setAttribute("role", "listitem");
    plaza.setAttribute("aria-label", `Plaza ${numero}: sin datos`);
    rejilla.appendChild(plaza);
  }

  const reloj = document.getElementById("reloj");
  const actualizarReloj = () => {
    reloj.textContent = new Date().toLocaleString("es-ES", {
      weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  };
  actualizarReloj();
  window.setInterval(actualizarReloj, 1000);
}

iniciarConexion();
if (document.body.dataset.pagina === "control") iniciarControl();