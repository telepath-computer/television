No blocking findings. The cuts preserve the needed contracts and decisions through retained statements or references to their owners. I found no dangling citations to the removed block ref or headings.

1. **Non-blocking — duplicated selection rules.** In [channel-state/index.md, “The client state layer”](/home/user/workspace/wt/television/trim-core/specs/arch/channel-state/index.md:142), the selection-memory bullet repeats the prohibition on persistence already owned by `product/tab-pages.md#^tp-selection-local`, then explicitly claims that prohibition for this spec too. Keep the architectural placement of selection memory here, and refer to the product owner for its lifetime and persistence rules. This removes duplicate ownership without weakening the requirement.

2. **Non-blocking — backlog text remains.** In [channels.md, “What a channel is,” Identity](/home/user/workspace/wt/television/trim-core/specs/product/channels.md:23), “Closing the gap is tracked as TV-549” describes future work. The preceding explanation already preserves the accepted caller-supplied-ID limitation and its consequence for sortability. Remove the tracking sentence; retain that limitation.

The removed `ly-no-splits` paragraph does not need restoration: the retained geometry type, membership-preservation rule, and validation requirements sufficiently establish the current model. The multi-artifact storage decision also remains explicit.

Converged: yes