import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { PrismaClient } from "@prisma/client";
import { cors } from "hono/cors";
import { EventEmitter } from "events";
import { exec } from "child_process";
import { promisify } from "util";

const app = new Hono();
const prisma = new PrismaClient();
const eventEmitter = new EventEmitter();
const execPromise = promisify(exec);

type OrdersType = {
  mail?: string;
  item: string;
  quantity: number;
}[];

app.use("*", cors());

app.post("/orders", async (c) => {
  const ordersReq = await c.req.json<OrdersType>();
  const generateID = (isMobile: boolean) => {
    const prefix = isMobile ? "M" : "D";
    return prefix + Math.floor(Math.random() * 1000);
  };
  const orderID = generateID(!!ordersReq[0].mail);
  const itemIds = ordersReq.map((r) => {
    return prisma.items.findFirst({
      where: {
        item_name: r.item,
      },
      select: {
        id: true,
      }
    })
  });
  const order = await prisma.orders.create({
    data: {
      order_id: orderID,
      is_created: false,
      address: ordersReq[0].mail ?? "POS",
    },
  })
  ordersReq.forEach(async (r, i) => {
    const id = (await itemIds[i])?.id;
    console.log(r);
    console.log(id);
    if (id) {
      await prisma.orderItems.create({
        data: {
          order_id: order.id,
          item_id: id,
          quantity: r.quantity,
        },
      });
    }
  });
  eventEmitter.emit("orderCreated", { orderID, ordersReq });
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

app.get("/order-display", (c) => {
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

app.get("/stock-display", (c) => {
  const getCrowdLevel = async () => {
    try {
      const { stdout, stderr } = await execPromise("python crowd_level.py");
      if (stderr) {
        console.error(`stderr: ${stderr}`);
      }
      console.log(`stdout: ${stdout}`);
      eventEmitter.emit("crowdLevelUpdated", stdout);
      return stdout;
    } catch (error) {
      console.error(`exec error: ${error}`);
      throw error;
    }
  }
  const getStack = async () => {
    const stock = await prisma.items.findMany({
      select: {
        item_name: true,
        stock: true,
      },
    });
    return stock;
  }

  return c.json({
    stock: getStack(),
    crowdLevel: getCrowdLevel(),
  })
});

const port = 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
