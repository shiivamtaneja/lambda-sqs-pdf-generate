const chromium = require('@sparticuz/chromium');

const { launch } = require('puppeteer-core');

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const sqsClient = new SQSClient({
  region: process.env.AWS_S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_SQS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SQS_SECRET_ACCESS_KEY
  },
})

const awsS3Client = new S3Client({
  region: process.env.AWS_S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY
  },
});

exports.handler = async (event, context, callback) => {
  let result = null;
  let browser = null;

  try {
    browser = await launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    const body = JSON.parse(event.Records[0].body);

    await page.goto(body.url || 'https://example.com', { timeout: 60000 });

    await page.emulateMediaType('screen');

    const pdf = await page.pdf({
      printBackground: true,
      landscape: false,
    });

    result = pdf

    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `report-for-user-${body.user_id}-test-${body.test_id}-${Date.now()}`,
    };

    const s3Command = new PutObjectCommand(params);

    const url = await getSignedUrl(awsS3Client, s3Command, { expiresIn: 3600 });

    await fetch(url, {
      method: 'PUT',
      body: result,
      headers: {
        'Content-Type': 'application/pdf',
      }
    });

    const imageUrl = url.split('?')[0];

    const command = new SendMessageCommand({
      MessageBody: JSON.stringify({
        url: imageUrl,
        user_id: body.user_id,
        test_id: body.test_id,
      }),
      QueueUrl: process.env.AWS_SQS_PDF_URL,
    })

    await sqsClient.send(command);
  } catch (error) {
    return callback(error);
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }

  return callback(null, result);
};