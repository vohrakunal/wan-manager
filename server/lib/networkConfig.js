const NETWORK = {
  zte: {
    iface: process.env.ZTE_IFACE || 'enx9c69d33a8e81',
    gateway: process.env.ZTE_GATEWAY || '192.168.20.1',
    ip: process.env.ZTE_IP || '192.168.20.75',
  },
  digisol: {
    iface: process.env.DIGISOL_IFACE || 'enx207bd51a8b0b',
    gateway: process.env.DIGISOL_GATEWAY || '192.168.10.1',
    ip: process.env.DIGISOL_IP || '192.168.10.75',
  },
  lan: {
    iface: process.env.LAN_IFACE || 'eno1',
    ip: process.env.LAN_IP || '192.168.1.254',
  },
};

module.exports = { NETWORK };
