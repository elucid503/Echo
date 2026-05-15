package voice

import (
	"log"
	"sync"

	dvoice "github.com/disgoorg/disgo/voice"
	"github.com/disgoorg/snowflake/v2"
	"github.com/hraban/opus"
)

const FrameSamplesPerChannel = 960 // Number of PCM samples per channel produced from a single 20 ms Opus packet at 48 kHz.
const FrameSamplesTotal = FrameSamplesPerChannel * Channels // Total int16 count in a single decoded frame for stereo.

// Frame is a single decoded 20 ms PCM block tagged with the originating SSRC. The Mixer combines these.
type Frame struct {

	SSRC uint32

	PCM []int16 // Interleaved PCM samples: [L R L R L R ...] for stereo.

}

// Implements disgo's OpusFrameReceiver interface.
type Receiver struct {

	mu sync.Mutex

	decoders map[uint32]*opus.Decoder

	ssrcToUser map[uint32]snowflake.ID // Used for logging/status.

	Out chan Frame

	closed bool

}

// NewReceiver creates a Receiver. The Out channel is sized large enough to absorb short stalls in the mixer.
func NewReceiver() *Receiver {

	return &Receiver{

		decoders:   make(map[uint32]*opus.Decoder),
		ssrcToUser: make(map[uint32]snowflake.ID),

		Out: make(chan Frame, 64), // ~ 10 frames per speaker for up to 6 concurrent speakers.

	}

}

// ReceiveOpusFrame is called by disgo for every incoming voice packet.
func (r *Receiver) ReceiveOpusFrame(userID snowflake.ID, packet *dvoice.Packet) error {

	if packet == nil || len(packet.Opus) == 0 {

		return nil

	}

	decoder, err := r.decoderFor(packet.SSRC, userID)

	if err != nil {

		log.Printf("voice: opus decoder init failed for ssrc=%d: %v", packet.SSRC, err)

		return nil

	}

	pcm := make([]int16, FrameSamplesTotal)

	n, err := decoder.Decode(packet.Opus, pcm)

	if err != nil {

		log.Printf("voice: opus decode failed for ssrc=%d: %v", packet.SSRC, err)

		return nil

	}

	// n is samples-per-channel. We allocated for the max (960) but some frames may be shorter, so we slice to the actual length.

	pcm = pcm[:n * Channels]

	frame := Frame{SSRC: packet.SSRC, PCM: pcm}

	r.mu.Lock()
	closed := r.closed
	r.mu.Unlock()

	if closed {

		return nil

	}

	// Non-blocking send to the Out channel.

	select {

		case r.Out <- frame:

		default:

			log.Printf("voice: dropping frame from ssrc=%d (mixer backpressure)", packet.SSRC)

	}

	return nil

}

// decoderFor returns the cached opus.Decoder for the SSRC, creating one on first use.
func (r *Receiver) decoderFor(ssrc uint32, userID snowflake.ID) (*opus.Decoder, error) {

	r.mu.Lock()
	defer r.mu.Unlock()

	if userID != 0 {

		r.ssrcToUser[ssrc] = userID

	}

	if dec, ok := r.decoders[ssrc]; ok {

		return dec, nil

	}

	dec, err := opus.NewDecoder(SampleRate, Channels)

	if err != nil {

		return nil, err

	}

	r.decoders[ssrc] = dec

	log.Printf("voice: new opus decoder for ssrc=%d user=%s", ssrc, userID)

	return dec, nil

}

// CleanupUser is called by disgo when a user disconnects from the voice channel. We deallocate their decoder.
func (r *Receiver) CleanupUser(userID snowflake.ID) {

	r.mu.Lock()
	defer r.mu.Unlock()

	for ssrc, uid := range r.ssrcToUser {

		if uid == userID {

			delete(r.decoders, ssrc)
			delete(r.ssrcToUser, ssrc)

			log.Printf("voice: removed decoder for ssrc=%d user=%s", ssrc, userID)

		}

	}

}

// Close tears down the receiver.
func (r *Receiver) Close() {

	r.mu.Lock()

	if r.closed {

		r.mu.Unlock()

		return

	}

	r.closed = true
	r.decoders = map[uint32]*opus.Decoder{}
	r.ssrcToUser = map[uint32]snowflake.ID{}

	r.mu.Unlock()

	close(r.Out)

}

// SpeakerCount reports how many distinct SSRCs the receiver currently tracks.
func (r *Receiver) SpeakerCount() int {

	r.mu.Lock()
	defer r.mu.Unlock()

	return len(r.decoders)

}
