"use strict";

/*
=========================================================
SCANNER.JS
Scanner EAN-13 utilizando somente Barcode Detection API (Modo Lote + Recorte de Mira)
=========================================================
*/

let scannerVideo = null;
let scannerCanvas = null; // Canvas auxiliar para recortar a mira
let scannerStream = null;
let scannerTrack = null;
let barcodeDetector = null;

let scannerRodando = false;
let scannerFrame = null;

let ultimoCodigo = "";
let ultimoTempo = 0;

const SCANNER_CONFIG = {
    formatos: ["ean_13"],
    repetirApos: 1500,
    timeout: 60000,
    largura: 1920,
    altura: 1080,
    fps: 30,
    debug: true
};

function scannerLog(...msg){
    if(SCANNER_CONFIG.debug){
        console.log("[SCANNER]", ...msg);
    }
}

function scannerErro(...msg){
    console.error("[SCANNER]", ...msg);
}

function suportaScanner(){
    return (
        "BarcodeDetector" in window &&
        navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia
    );
}

async function iniciarScanner(videoId, callback){
    if(!suportaScanner()){
        throw new Error("Barcode Detection API não suportada.");
    }

    await pararScanner();

    scannerVideo = document.getElementById(videoId);
    if(!scannerVideo){
        throw new Error("Elemento de vídeo não encontrado.");
    }

    // Cria o canvas auxiliar de recorte caso ainda não exista
    if (!scannerCanvas) {
        scannerCanvas = document.createElement("canvas");
    }

    scannerStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            facingMode: { ideal: "environment" },
            width: { ideal: SCANNER_CONFIG.largura },
            height: { ideal: SCANNER_CONFIG.altura },
            frameRate: { ideal: SCANNER_CONFIG.fps }
        }
    });

    scannerVideo.srcObject = scannerStream;
    await scannerVideo.play();

    scannerTrack = scannerStream.getVideoTracks()[0];
    barcodeDetector = new BarcodeDetector({
        formats: SCANNER_CONFIG.formatos
    });

    scannerRodando = true;
    scannerLog("Scanner iniciado com recorte de mira central.");

    iniciarLoop(callback);
}

// =========================================================
// LOOP DE LEITURA RESTRITO À MIRA CENTRAL
// =========================================================

function iniciarLoop(callback){
    const inicio = Date.now();
    const ctx = scannerCanvas.getContext("2d", { willReadFrequently: true });

    async function loop(){
        if(!scannerRodando){
            return;
        }

        try{
            if(scannerVideo.readyState >= 2 && scannerVideo.videoWidth > 0){
                const vWidth = scannerVideo.videoWidth;
                const vHeight = scannerVideo.videoHeight;

                // Define as dimensões do recorte da MIRA CENTRAL (70% da largura, 25% da altura)
                const cropWidth = vWidth * 0.70;
                const cropHeight = vHeight * 0.25;
                const cropX = (vWidth - cropWidth) / 2;
                const cropY = (vHeight - cropHeight) / 2;

                // Redimensiona o canvas para o tamanho do recorte
                scannerCanvas.width = cropWidth;
                scannerCanvas.height = cropHeight;

                // Copia apenas a área da mira do vídeo para o canvas
                ctx.drawImage(
                    scannerVideo,
                    cropX, cropY, cropWidth, cropHeight, // Origem do vídeo
                    0, 0, cropWidth, cropHeight          // Destino no canvas
                );

                // Passa APENAS o canvas cortado para o leitor de código de barras
                const resultados = await barcodeDetector.detect(scannerCanvas);

                if(resultados.length){
                    for (const res of resultados) {
                        if (res.rawValue) {
                            processarCodigo(res.rawValue, callback);
                        }
                    }
                }
            }
        }
        catch(e){
            scannerErro(e);
        }

        if(Date.now() - inicio > SCANNER_CONFIG.timeout){
            scannerLog("Timeout.");
            pararScanner();
            return;
        }

        scannerFrame = requestAnimationFrame(loop);
    }

    loop();
}

// =========================================================
// PROCESSAMENTO COM DEBOUNCE E FILTRO DE RUÍDO
// =========================================================

let ultimoTempoLeituraGlobal = 0;
const INTERVALO_ENTRE_LEITURAS_MS = 800; // Tempo mínimo (ms) entre a leitura de duas etiquetas

function processarCodigo(codigo, callback) {
    const agora = Date.now();

    // Trava 1: Ignora leituras em sequência muito rápida para evitar ruído de quadros borrados
    if (agora - ultimoTempoLeituraGlobal < INTERVALO_ENTRE_LEITURAS_MS) {
        return;
    }

    let dados = null;
    try {
        dados = decodificarCodigoBarras(codigo);
    } catch(e) {
        scannerErro(e);
        return;
    }

    if (!dados) {
        return;
    }

    ultimoCodigo = codigo;
    ultimoTempo = agora;
    ultimoTempoLeituraGlobal = agora;

    scannerLog("Código válido lido dentro da mira:", codigo);

    callback(dados);
}

// =========================================================
// VALIDAÇÃO EAN13 RIGOROSA
// =========================================================

function validarEAN13(codigo) {
    if (!codigo) return false;
    codigo = codigo.replace(/\D/g, "");
    
    if (codigo.length !== 13) return false;

    // Trava 2: Etiquetas de balança obrigatoriamente começam com '2' (20, 21, 22, etc.)
    if (!codigo.startsWith("2")) {
        return false;
    }

    let soma = 0;
    for (let i = 0; i < 12; i++) {
        const n = parseInt(codigo[i], 10);
        soma += (i % 2 === 0) ? n : n * 3;
    }

    const digito = (10 - (soma % 10)) % 10;
    return digito === parseInt(codigo[12], 10);
}

// =========================================================
// PARAR SCANNER
// =========================================================

async function pararScanner(){
    scannerRodando = false;

    if(scannerFrame){
        cancelAnimationFrame(scannerFrame);
        scannerFrame = null;
    }

    if(scannerTrack){
        scannerTrack.stop();
        scannerTrack = null;
    }

    if(scannerStream){
        scannerStream.getTracks().forEach(t=>t.stop());
        scannerStream = null;
    }

    if(scannerVideo){
        scannerVideo.pause();
        scannerVideo.srcObject = null;
    }

    barcodeDetector = null;
    ultimoCodigo = "";
    ultimoTempo = 0;

    scannerLog("Scanner encerrado.");
}

// =========================================================
// LANTERNA E ZOOM
// =========================================================

function possuiLanterna(){
    if(!scannerTrack) return false;
    const cap = scannerTrack.getCapabilities();
    return !!cap.torch;
}

async function ligarLanterna(){
    if(!possuiLanterna()) return false;
    await scannerTrack.applyConstraints({ advanced: [{ torch: true }] });
    return true;
}

async function desligarLanterna(){
    if(!possuiLanterna()) return false;
    await scannerTrack.applyConstraints({ advanced: [{ torch: false }] });
    return true;
}

async function definirZoom(valor){
    if(!scannerTrack) return;
    const cap = scannerTrack.getCapabilities();
    if(!cap.zoom) return;
    valor = Math.max(cap.zoom.min, Math.min(valor, cap.zoom.max));
    await scannerTrack.applyConstraints({ advanced: [{ zoom: valor }] });
}

// =========================================================
// DECODIFICAÇÃO
// =========================================================

function decodificarCodigoBarras(texto){
    const cfg = APP_CONFIG.BARCODE_CONFIG;
    const digitos = (texto || "").replace(/\D/g,"");

    if(!validarEAN13(digitos)){
        scannerLog("EAN13 inválido:", digitos);
        return null;
    }

    const codigo = digitos.slice(cfg.codigoInicio, cfg.codigoFim).replace(/^0+/,"") || "0";

    let peso = null;
    if(cfg.usaPesoEmbutido){
        const bloco = digitos.slice(cfg.pesoInicio, cfg.pesoFim);
        if(bloco){
            peso = parseInt(bloco, 10) / Math.pow(10, cfg.pesoCasasDecimais);
        }
    }

    let preco = null;
    if(cfg.usaPrecoEmbutido){
        const bloco = digitos.slice(cfg.precoInicio, cfg.precoFim);
        if(bloco){
            preco = parseInt(bloco, 10) / Math.pow(10, cfg.precoCasasDecimais);
        }
    }

    let valorTotal = null;
    if(cfg.usaValorTotalEmbutido){
        const bloco = digitos.slice(cfg.valorTotalInicio, cfg.valorTotalFim);
        if(bloco){
            valorTotal = parseInt(bloco, 10) / Math.pow(10, cfg.valorTotalCasasDecimais);
        }
    }

    return {
        codigoBruto: digitos,
        codigo,
        peso,
        preco,
        valorTotal
    };
}

window.iniciarScanner = iniciarScanner;
window.pararScanner = pararScanner;
window.ligarLanterna = ligarLanterna;
window.desligarLanterna = desligarLanterna;
window.definirZoom = definirZoom;