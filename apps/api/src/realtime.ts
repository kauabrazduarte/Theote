type Client = Bun.ServerWebSocket<unknown>;
const clients = new Set<Client>();

export function broadcast(type:string,payload:unknown) {
  const message=JSON.stringify({type,payload});
  for(const client of clients) {
    try { client.send(message); } catch { clients.delete(client); }
  }
}

export function addClient(client:Client) { clients.add(client); }
export function removeClient(client:Client) { clients.delete(client); }
