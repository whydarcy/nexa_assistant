// AudioWorklet Processor для обработки аудио для Vosk
class VoskAudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        // Получаем sampleRate из processorOptions или используем глобальный sampleRate
        this.sampleRate = options.processorOptions?.sampleRate || sampleRate || 16000;
        console.log('[AudioWorklet] Инициализирован с sampleRate:', this.sampleRate);
        this.port.onmessage = (event) => {
            // Обработка сообщений от основного потока (если нужно)
        };
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (input && input.length > 0) {
            const inputChannel = input[0];
            
            if (inputChannel && inputChannel.length > 0) {
                // Отправляем данные напрямую в основной поток
                // Клонируем Float32Array для передачи через postMessage
                const bufferCopy = new Float32Array(inputChannel);
                // ВАЖНО: sampleRate должен быть числом, не undefined
                const sr = Number(this.sampleRate) || 16000;
                this.port.postMessage({
                    type: 'audioData',
                    data: bufferCopy,
                    sampleRate: sr // Явно преобразуем в число
                }, [bufferCopy.buffer]); // Передаем ArrayBuffer для эффективности
            }
        }
        
        // Возвращаем true, чтобы процессор продолжал работать
        return true;
    }
}

registerProcessor('vosk-audio-processor', VoskAudioProcessor);

