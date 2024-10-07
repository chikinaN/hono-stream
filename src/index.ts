import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { PrismaClient } from "@prisma/client";
import { cors } from "hono/cors";
import { EventEmitter } from "events";

const app = new Hono();
const prisma = new PrismaClient();
const eventEmitter = new EventEmitter();

type OrdersType = {
  mail?: string;
  item: string;
  quantity: number;
}[];

app.use("*", cors());

app.post("/orders", async (c) => {
  const orders = await c.req.json<OrdersType>();
  const generateID = (isMobile: boolean) => {
    const prefix = isMobile ? "M" : "D";
    return prefix + Math.floor(Math.random() * 1000);
  };
  const orderID = generateID(!!orders[0].mail);
  const itemIds = orders.map((r) => {
    return prisma.items.findFirst({
      where: {
        item_name: r.item,
      },
      select: {
        id: true,
      }
    })
  });
  orders.forEach(async (r, i) => {
    const id = (await itemIds[i])?.id;
    console.log(r);
    if (id) {
      await prisma.orders.create({
        data: {
          order_id: orderID,
          address: r.mail ?? "POS",
          item_id: id,
          quantity: r.quantity,
          is_created: false,
        },
      });
    }
  });
  eventEmitter.emit("orderCreated", { orderID, orders });
  return c.json({
    status: "success",
    order_id: orderID,
  });
});

app.post("/create/:id", async (c) => {
  const id = c.req.param("id");
  const orders = await prisma.orders.findMany({
    where: { order_id: id },
  });
  const updatedOrders = await Promise.all(
    orders.map(async (order) => {
      return await prisma.orders.update({
        where: {
          id: order.id,
        },
        data: {
          is_created: true,
        },
      });
    })
  );

  eventEmitter.emit("orderUpdated", { id, updatedOrders });
  return c.json({
    status: "success",
    updatedOrders,
  });
});

app.get("/stream", (c) => {
  return streamSSE(c, async (stream) => {
    const onOrderCreated = (data: any) => {
      stream.writeSSE({
        data: JSON.stringify(data),
        event: "orderCreated",
      });
    };

    const onOrderUpdated = (data: any) => {
      stream.writeSSE({
        data: JSON.stringify(data),
        event: "orderUpdated",
      });
    };

    eventEmitter.on("orderCreated", onOrderCreated);
    eventEmitter.on("orderUpdated", onOrderUpdated);

    stream.close = async () => {
      eventEmitter.off("orderCreated", onOrderCreated);
      eventEmitter.off("orderUpdated", onOrderUpdated);
    };

    while (true) {
      stream.writeSSE({
        data: "ping",
        event: "ping",
      });
      await stream.sleep(30000);
    }
  });
});

const port = 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
