require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 3000;

// firebase admin setup
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);

const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware
const allowedOrigins = [
  "http://localhost:5173", // dev environment
  // 'https://your-frontend-domain.com', // production frontend URL
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
app.use(express.json());

// verify firebase token

const verifyFBToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res
      .status(401)
      .send({ error: true, message: "Unauthorized access" });
  }

  const token = authorization.split(" ")[1];

  try {
    const decodedUser = await admin.auth().verifyIdToken(token);
    req.decoded = decodedUser;
    next();
  } catch (error) {
    return res.status(403).send({ error: true, message: "Forbidden" });
  }
};

// verify admin

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.psjt8aa.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("SkyTower").collection("users");
    const apartmentsCollection = client.db("SkyTower").collection("apartments");
    const agreementsCollection = client.db("SkyTower").collection("agreements");
    const paymentsCollection = client.db("SkyTower").collection("payments");
    const couponsCollection = client.db("SkyTower").collection("coupons");
    const announcementsCollection = client
      .db("SkyTower")
      .collection("announcements");

    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded?.email;
        if (!email) {
          return res.status(401).send({ error: true, message: "Unauthorized" });
        }

        const user = await usersCollection.findOne({ email });

        if (!user || user.role !== "admin") {
          return res
            .status(403)
            .send({ error: true, message: "Forbidden: Admins only" });
        }

        next();
      } catch (error) {
        console.error("Admin check error:", error);
        res.status(500).send({ error: true, message: "Internal server error" });
      }
    };

    // users

    app.get("/users", verifyFBToken, async (req, res) => {
      const { email, role } = req.query;

      const filter = {};
      if (email) filter.email = email;
      if (role) filter.role = role;

      try {
        const users = await usersCollection.find(filter).toArray();
        // If specific email is queried and only one result is expected
        if (email && !role) {
          return res.send(users[0] || null);
        }
        res.send(users);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    app.post("/users", verifyFBToken, async (req, res) => {
      const user = req.body;
      if (!user.email) {
        return res.status(400).json({ message: "Email is required" });
      }
      // Check if user already exists
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) {
        return res
          .status(200)
          .json({ message: "User already exists", user: existing });
      }
      // Insert new user
      const result = await usersCollection.insertOne(user);
      res
        .status(201)
        .json({ message: "User created", insertedId: result.insertedId });
    });

    app.patch("/users", verifyFBToken, verifyAdmin, async (req, res) => {
      const email = req.query.email;
      const updateDoc = {
        $set: {
          role: req.body.role, // expected: 'user'
        },
      };
      const result = await usersCollection.updateOne({ email }, updateDoc);
      res.send(result);
    });

    // Apartments
    app.get("/apartments", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = 6;
      const skip = (page - 1) * limit;

      const minRent = parseInt(req.query.minRent) || 0;
      const maxRent = parseInt(req.query.maxRent) || Infinity;

      const query = {
        rent: { $gte: minRent, $lte: maxRent },
      };

      try {
        const total = await apartmentsCollection.countDocuments(query);
        const apartments = await apartmentsCollection
          .find(query)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          apartments,
        });
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch apartments" });
      }
    });

    // agreements
    app.get("/agreements", verifyFBToken, async (req, res) => {
      try {
        const { email } = req.query;
        let query = {};
        if (email) query.userEmail = email;

        const agreements = await agreementsCollection.find(query).toArray();
        res.send(agreements);
      } catch (error) {
        console.error("Error fetching agreements:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/member-agreements", verifyFBToken, async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        // Check user role by email
        const user = await usersCollection.findOne({ email });

        if (!user || user.role !== "member") {
          return res
            .status(403)
            .send({ message: "Access denied. Only members allowed." });
        }

        // Get agreements for the user
        const agreements = await agreementsCollection.findOne({
          userEmail: email,
        });

        res.send(agreements);
      } catch (error) {
        console.error("Error fetching member agreements:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.post("/agreements", verifyFBToken, async (req, res) => {
      try {
        const agreement = req.body;

        if (
          !agreement.userEmail ||
          !agreement.apartmentNo ||
          !agreement.floor ||
          !agreement.block ||
          !agreement.rent
        ) {
          return res.status(400).send({ message: "Missing required fields" });
        }

        const { userEmail } = req.body;
        const existing = await agreementsCollection.findOne({ userEmail });

        if (existing) {
          return res
            .status(400)
            .json({ message: "User already has an agreement." });
        }

        agreement.createdAt = new Date();
        const result = await agreementsCollection.insertOne(agreement);
        res.send(result);
      } catch (error) {
        console.error("Error adding agreement:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // PATCH: Accept agreement & update role
    app.patch(
      "/agreements/:id/accept",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const agreementFilter = { _id: new ObjectId(id) };
        const agreementUpdate = { $set: { status: "checked" } };

        const agreementResult = await agreementsCollection.updateOne(
          agreementFilter,
          agreementUpdate
        );

        const { email } = req.body;
        const userFilter = { email };
        const roleUpdate = { $set: { role: "member" } };

        const userResult = await usersCollection.updateOne(
          userFilter,
          roleUpdate
        );

        res.send({ agreementResult, userResult });
      }
    );

    // PATCH: Reject agreement (no role change)
    app.patch(
      "/agreements/:id/reject",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const agreementFilter = { _id: new ObjectId(id) };
        const agreementUpdate = { $set: { status: "checked" } };

        const result = await agreementsCollection.updateOne(
          agreementFilter,
          agreementUpdate
        );
        res.send(result);
      }
    );

    // Announcements
    app.get("/announcements", verifyFBToken, async (req, res) => {
      const result = await announcementsCollection.find().toArray();
      res.send(result);
    });

    app.post("/announcements", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const { title, description, importance, type } = req.body;

        const newAnnouncement = {
          title,
          description,
          importance,
          type,
          createdAt: new Date(),
        };

        const result = await announcementsCollection.insertOne(newAnnouncement);
        res.status(201).json({ message: "Announcement created successfully" });
      } catch (error) {
        res.status(500).json({ error: "Failed to create announcement" });
      }
    });

    // Payment

    // payment-intent
    app.post("/create-payment-intent", verifyFBToken, async (req, res) => {
      const { rent } = req.body;
      const amount = parseInt(rent * 100); // Stripe uses cents

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).send({ message: "Payment Intent Error", error });
      }
    });

    // payment history
    // Example Express.js route
    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ error: "Email is required" });

      const payments = await paymentsCollection
        .find({ email })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(payments);
    });

    app.post("/payments", verifyFBToken, async (req, res) => {
      try {
        const paymentData = req.body;
        const result = await paymentsCollection.insertOne(paymentData);
        res.send(result);
      } catch (error) {
        console.error("Payment save error:", error);
        res.status(500).send({ message: "Failed to save payment" });
      }
    });

    // coupons

    app.get("/coupons", async (req, res) => {
      try {
        const coupons = await couponsCollection.find().toArray();
        res.send(coupons);
      } catch (error) {
        console.error("Failed to fetch coupons:", error);
        res
          .status(500)
          .send({ message: "Server error while fetching coupons" });
      }
    });

    app.get("/validate-coupon", verifyFBToken, async (req, res) => {
      try {
        const { code } = req.query;

        if (!code) {
          return res
            .status(400)
            .send({ valid: false, message: "Coupon code is required" });
        }

        const coupon = await couponsCollection.findOne({ code });

        if (!coupon) {
          return res.send({ valid: false, message: "Coupon not found" });
        }

        const currentDate = new Date();
        const expiryDate = new Date(coupon.expiryDate);

        if (expiryDate < currentDate) {
          return res.send({ valid: false, message: "Coupon has expired" });
        }

        res.send({
          valid: true,
          discountPercentage: Number(coupon.discount), // Ensure it's a number
          message: "Coupon applied successfully",
        });
      } catch (error) {
        console.error("Error validating coupon:", error);
        res
          .status(500)
          .send({ valid: false, message: "Internal server error" });
      }
    });

    app.post("/coupons", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const coupon = req.body;
        const result = await couponsCollection.insertOne(coupon);
        res.status(201).send(result);
      } catch (error) {
        console.error("Failed to add coupon:", error);
        res.status(500).send({ message: "Server error while adding coupon" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello SkyTower!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
