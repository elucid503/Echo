package voice

import (
	"encoding/binary"
	"log"
	"sync"
	"time"
)

const FrameBytes = FrameSamplesTotal * BytesPerSample // Size of a single 20 ms mixed PCM frame
const FrameInterval = 20 * time.Millisecond // How often the mixer emits a frame.
const maxPendingPerSSRC = 3 // Maximum number of unprocessed frames queued per SSRC before the oldest are discarded.

// Broadcaster is the interface the mixer needs to send a mixed frame out over WebSockets.
type Broadcaster interface {

	Broadcast(frame []byte)

}

// Mixer consumes PCM frames from a Receiver, mixes and then writes to both the circular buffer and the broadcaster.
type Mixer struct {

	receiver    *Receiver
	buffer      *Buffer
	broadcaster Broadcaster

	stop chan struct{}
	done chan struct{}

	mu sync.Mutex

	pending map[uint32][][]int16 // a FIFO queue of unprocessed frames per SSRC.

	acc []int32 // a pre-allocated int32 accumulator reused each tick to avoid per-tick allocation.

}

func NewMixer(receiver *Receiver, buffer *Buffer, broadcaster Broadcaster) *Mixer {

	return &Mixer{

		receiver:    receiver,
		buffer:      buffer,
		broadcaster: broadcaster,

		stop: make(chan struct{}),
		done: make(chan struct{}),

		pending: make(map[uint32][][]int16),
		acc:     make([]int32, FrameSamplesTotal),

	}

}

// Start launches the mixer goroutines. The mixer should be stopped by calling Stop.
func (m *Mixer) Start() {

	go m.ingest()
	go m.tickLoop()

}

func (m *Mixer) ingest() {

	for frame := range m.receiver.Out {

		m.mu.Lock()

		q := m.pending[frame.SSRC]

		if len(q) >= maxPendingPerSSRC {

			// Queue full — discard oldest to make room for the newer frame.
			q = q[1:]

		}

		m.pending[frame.SSRC] = append(q, frame.PCM)

		m.mu.Unlock()

	}

}

func (m *Mixer) tickLoop() {

	defer close(m.done)

	ticker := time.NewTicker(FrameInterval)
	defer ticker.Stop()

	silence := make([]byte, FrameBytes)

	for {

		select {

		case <-m.stop:

			return

		case <-ticker.C:

			frame := m.mixWindow()

			if frame == nil {

				// No speakers, emit silence.

				frame = silence

			}

			m.buffer.WriteAudio(frame)

			if m.broadcaster != nil {

				m.broadcaster.Broadcast(frame)

			}

		}

	}

}

// mixWindow takes the oldest pending frame from each SSRC queue, mixes them and returns the resulting PCM frame. Returns nil if no frames to mix.
func (m *Mixer) mixWindow() []byte {

	m.mu.Lock()

	if len(m.pending) == 0 {

		m.mu.Unlock()

		return nil

	}

	// Finds the oldest frames to mix for this tick.

	frames := make([][]int16, 0, len(m.pending))

	for ssrc, q := range m.pending {

		frames = append(frames, q[0])

		if len(q) == 1 {

			delete(m.pending, ssrc)

		} else {

			m.pending[ssrc] = q[1:]

		}

	}

	m.mu.Unlock()

	// Zeroes and reuses the pre-allocated accumulator to avoid per-tick allocation.

	for i := range m.acc {

		m.acc[i] = 0

	}

	for _, pcm := range frames {

		limit := len(pcm)

		if limit > FrameSamplesTotal {

			limit = FrameSamplesTotal

		}

		for i := 0; i < limit; i++ {

			m.acc[i] += int32(pcm[i])

		}

	}

	out := make([]byte, FrameBytes)

	for i, sample := range m.acc {

		binary.LittleEndian.PutUint16(out[i*2:i*2+2], uint16(saturate(sample)))

	}

	return out

}

// Stop signals the mixer to wind down and waits for the tick goroutine to exit.
func (m *Mixer) Stop() {

	select {

	case <-m.stop:

		return

	default:

		close(m.stop)

	}

	<-m.done

	log.Printf("voice: mixer stopped")

}

// saturate clamps the given sample to the int16 range.
func saturate(sample int32) int16 {

	if sample > 32767 {

		return 32767

	}

	if sample < -32768 {

		return -32768

	}

	return int16(sample)

}
