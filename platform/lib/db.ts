import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let prismaInstance: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
  if (prismaInstance) {
    return prismaInstance;
  }

  try {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });

    // Test connection, but don't block if it fails
    prismaInstance.$connect().catch((error) => {
      console.warn("Prisma connection warning (non-blocking):", error.message);
    });

    return prismaInstance;
  } catch (error: any) {
    console.error("Failed to create Prisma client:", error.message);
    // Return a mock client that throws on use
    return {
      $connect: async () => {},
      $disconnect: async () => {},
    } as any;
  }
}

export const prisma =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
