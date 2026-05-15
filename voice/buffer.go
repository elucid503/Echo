package voice

import (
	"sync"
)

// Constants describing the PCM stream produced by the mixer.
const (

	SampleRate = 48000
	Channels = 2
	BytesPerSample = 2 // int16 little-endian

	BufferSeconds = 15

	BytesPerSecond = SampleRate * Channels * BytesPerSample
	BufferBytes = BytesPerSecond * BufferSeconds

)

type bufferState struct {

	writePos int
	full     bool

}

// Buffer is a thread-safe circular byte buffer that holds the most recent BufferSeconds worth of mixed PCM.
type Buffer struct {

	mu sync.RWMutex

	data []byte

	state bufferState

}

func NewBuffer() *Buffer {

	return &Buffer{

		data: make([]byte, BufferBytes),

		state: bufferState{},

	}

}

// WriteAudio appends pcmData to the circular buffer, overwriting the oldest audio when the buffer fills.
func (b *Buffer) WriteAudio(pcmData []byte) {

	b.mu.Lock()
	defer b.mu.Unlock()

	capacity := len(b.data)

	for len(pcmData) > 0 {

		chunk := capacity - b.state.writePos

		if chunk > len(pcmData) {

			chunk = len(pcmData)

		}

		copy(b.data[b.state.writePos:], pcmData[:chunk])

		b.state.writePos = (b.state.writePos + chunk) % capacity

		if b.state.writePos == 0 {

			b.state.full = true

		}

		pcmData = pcmData[chunk:]

	}

}

// GetAudio returns a copy of the full buffer contents in chronological order (oldest sample first).
func (b *Buffer) GetAudio() []byte {

	b.mu.RLock()
	defer b.mu.RUnlock()

	if !b.state.full {

		audioCopy := make([]byte, b.state.writePos)
		copy(audioCopy, b.data[:b.state.writePos])

		return audioCopy

	}

	audioCopy := make([]byte, len(b.data))

	n := copy(audioCopy, b.data[b.state.writePos:])
	copy(audioCopy[n:], b.data[:b.state.writePos])

	return audioCopy

}

// GetLastN returns the most recent seconds of audio (clamped to whatever the buffer actually contains)
func (b *Buffer) GetLastN(seconds float64) []byte {

	if seconds <= 0 {

		return nil

	}

	if seconds > BufferSeconds {

		seconds = BufferSeconds

	}

	wanted := int(float64(BytesPerSecond) * seconds)

	// aligns to a frame boundary (int16 stereo = 4 bytes) so callers always receive a whole number of samples.

	wanted -= wanted % (Channels * BytesPerSample)

	b.mu.RLock()
	defer b.mu.RUnlock()

	available := b.state.writePos

	if b.state.full {

		available = len(b.data)

	}

	if wanted > available {

		wanted = available

	}

	out := make([]byte, wanted)

	if wanted == 0 {

		return out

	}

	// walks back wanted bytes from the current write position, wrapping around if necessary.

	start := b.state.writePos - wanted

	capacity := len(b.data)

	if start < 0 {

		start += capacity

	}

	if start+wanted <= capacity {

		copy(out, b.data[start:start+wanted])

		return out

	}

	n := copy(out, b.data[start:])
	copy(out[n:], b.data[:wanted-n])

	return out

}

// Clear resets the buffer to a silent state. Uses a mutex, so safe to call concurrently.
func (b *Buffer) Clear() {

	b.mu.Lock()
	defer b.mu.Unlock()

	for i := range b.data {

		b.data[i] = 0

	}

	b.state = bufferState{}

}
