import { createManager } from '../../core/mikrotik.js';

/** Infrastructure adapter: keeps MikroTik knowledge outside the kernel. */
export const mikrotikNodeFactory = {
  create(host, username, password, port = 8728) {
    return createManager({ host, port, username, password });
  },
};

export default mikrotikNodeFactory;
