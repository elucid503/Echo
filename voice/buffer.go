package voice

type bufferState struct {

	writePos int
	full bool

}

type Buffer struct {

	// circular buffer storing 15s of PCM audio (48kHz, 16-bit, stereo)

	data []byte

	state bufferState

}

func NewBuffer() *Buffer {

	return &Buffer{

		data: make([]byte, (48000) * (2 * 2) * (15)), // 48kHz * 16-bit * stereo * 15s

		state: bufferState{},

	}

}

func (b *Buffer) WriteAudio(pcmData []byte) {

	capacity := len(b.data)

	for len(pcmData) > 0 {

		chunk := capacity - b.state.writePos // calculates how much space is left from the current write position to the end of the buffer

		if chunk > len(pcmData) {

			chunk = len(pcmData) // if the chunk size is larger than the remaining PCM data, adjust it to fit the remaining data

		}

		copy(b.data[b.state.writePos:], pcmData[:chunk]) // copy the chunk of PCM data into the buffer at the current write position

		b.state.writePos = (b.state.writePos + chunk) % capacity // updates the write position, wrapping around to the beginning of the buffer if necessary

		if b.state.writePos == 0 {

			b.state.full = true

		}

		pcmData = pcmData[chunk:]

	}

}

func (b *Buffer) GetAudio() []byte {

	if !b.state.full {

		// If the buffer is not full, we can simply return the portion of the buffer that has been written to

		audioCopy := make([]byte, b.state.writePos)

		copy(audioCopy, b.data[:b.state.writePos])

		return audioCopy

	}

	// Here, we need to return the audio data starting from the current write position to the end of the buffer, and then from the beginning of the buffer to the current write position

	audioCopy := make([]byte, len(b.data))

	n := copy(audioCopy, b.data[b.state.writePos:])

	copy(audioCopy[n:], b.data[:b.state.writePos])

	return audioCopy

}

func (b *Buffer) Clear() {

	b.data = make([]byte, len(b.data))

	b.state = bufferState{}

}
