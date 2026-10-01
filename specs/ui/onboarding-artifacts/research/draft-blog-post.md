# DRAFT BLOG POST: Open Models As the Future of Computing

## Proposed outline (based on research and personal notes)

### The Core Principle

- The future of computing cannot be built on rented intelligence

### User Sovereignty

- Hosted APIs mean you license intelligence, not own it — providers control what's acceptable and can change the rules anytime
- Open models restore a basic property of computing: you run the program, and it does what you tell it
- The model is a file. The file is yours.

### Privacy

- Every prompt sent to a hosted API is data leaving your perimeter
- Open models run locally — data never leaves the machine, no provider logging or training on your conversations
- Threat model collapses from "trust the entire cloud AI supply chain" to "trust the hardware in front of you"

### Resistance to Censorship and Revocation

- A product built on a hosted API is one policy update away from breaking
- Open models cannot be revoked — once you have the weights, you have them
- Tools built on open models are resistant to censorship by design — a model on a laptop in a restricted region cannot be turned off from headquarters

### Latency

- Every API call is a network round trip — tolerable for batch, a fundamental bottleneck for interactive interfaces
- A 200ms API latency feels sluggish; a 20ms local inference feels like magic
