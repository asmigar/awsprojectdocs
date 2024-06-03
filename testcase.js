// Import the required modules from AWS SDK v3
const { EC2Client, DescribeVpcsCommand, DescribeVpcPeeringConnectionsCommand, DescribeRouteTablesCommand } = require('@aws-sdk/client-ec2');

// Set the region
const REGION_NAME = 'us-west-1';

const result = [
  { weightage: 0, name: "VPC name is 'User'", status: false, error: '' },
  { weightage: 0, name: "VPC 'User' IPv4 CIDR is '172.168.0.0/16'", status: false, error: '' },
  { weightage: 0, name: "VPC name is 'Testing'", status: false, error: '' },
  { weightage: 0, name: "VPC 'Testing' IPv4 CIDR is '172.169.0.0/16'", status: false, error: '' },
  { weightage: 0, name: "VPC Peering Name is 'User-Testing'", status: false, error: '' },
  { weightage: 0, name: "Route entries between User and Testing are correct", status: false, error: '' },
  { weightage: 0, name: "Route entries between Testing and User are correct", status: false, error: '' }
];

// Create EC2 service object
const ec2 = new EC2Client({ region: REGION_NAME , credentials, });

async function validateConditions() {
  try {
    // Describe VPCs
    const vpcsData = await ec2.send(new DescribeVpcsCommand({}));

    // Get VPC IDs by name
    const user = vpcsData.Vpcs.find(vpc => vpc.Tags && vpc.Tags.some(tag => tag.Key === 'Name' && tag.Value === 'User'));
    const testing = vpcsData.Vpcs.find(vpc => vpc.Tags && vpc.Tags.some(tag => tag.Key === 'Name' && tag.Value === 'Testing'));

    // Flag to track if any VPC name is found
    let vpcNameFound = false;

    // Loop through each VPC
    for (const vpc of vpcsData.Vpcs) {
      if (vpc.Tags) {
        const vpcNameTag = vpc.Tags.find(tag => tag.Key === 'Name');
        if (vpcNameTag) {
          vpcNameFound = true;  // Set the flag if at least one VPC name is found
          if (vpcNameTag.Value === 'User') {
            result[0].weightage = 0.1;
            result[0].status = true;

            // Check IPv4 CIDR
            if (vpc.CidrBlock === '172.168.0.0/16') {
              result[1].weightage = 0.1;
              result[1].status = true;
            } else {
              result[1].error = "VPC 'User' IPv4 CIDR is not '172.168.0.0/16'";
            }
          } else if (vpcNameTag.Value === 'Testing') {
            result[2].weightage = 0.1;
            result[2].status = true;

            // Check IPv4 CIDR
            if (vpc.CidrBlock === '172.169.0.0/16') {
              result[3].weightage = 0.1;
              result[3].status = true;
            } else {
              result[3].error = "VPC 'Testing' IPv4 CIDR is not '172.169.0.0/16'";
            }
          }
        }
      }
    }

    // If no VPC name is found, set the error in the result array
    if (!vpcNameFound) {
      result[0].error = "VPC name 'User' not available";
      result[1].error = "VPC 'User' IPv4 CIDR is not '172.168.0.0/16'";
      result[2].error = "VPC name 'Testing' not available";
      result[3].error = "VPC 'Testing' IPv4 CIDR is not '172.169.0.0/16'";
    }

    // Describe VPC peering connections
    const peeringConnectionsData = await ec2.send(new DescribeVpcPeeringConnectionsCommand({}));

    // Loop through each VPC peering connection
    if (peeringConnectionsData.VpcPeeringConnections.length > 0) {
      for (const peeringConnection of peeringConnectionsData.VpcPeeringConnections) {
        const accepterVpcInfo = peeringConnection.AccepterVpcInfo && peeringConnection.AccepterVpcInfo.CidrBlock;
        const requesterVpcInfo = peeringConnection.RequesterVpcInfo && peeringConnection.RequesterVpcInfo.CidrBlock;

        // Check if peering connection name is 'User-Testing' and it's active
        if (peeringConnection.Tags && peeringConnection.Tags.some(tag => tag.Key === 'Name' && tag.Value === 'User-Testing') &&
          peeringConnection.Status && peeringConnection.Status.Code === 'active') {
          result[4].weightage = 0.2;
          result[4].status = true;
        } else {
          result[4].error = "VPC Peering Name is not 'User-Testing'";
        }

        // Check if the peering connection involves Testing as accepter and User as requester
        if (
          testing && accepterVpcInfo === testing.CidrBlock &&
          user && requesterVpcInfo === user.CidrBlock
        ) {
          const userRouteTableId = await getMainRouteTableId(user.VpcId);
          const testingRouteTableId = await getMainRouteTableId(testing.VpcId);

          if (await hasCIDRInRouteTable(userRouteTableId, testing.CidrBlock)) {
            result[5].weightage = 0.2;
            result[5].status = true;
          } else {
            result[5].error = "Route entries between User and Testing are not correct";
          }

          if (await hasCIDRInRouteTable(testingRouteTableId, user.CidrBlock)) {
            result[6].weightage = 0.2;
            result[6].status = true;
          } else {
            result[6].error = "Route entries between Testing and User are not correct";
          }
        } else {
          result[5].error = "Route entries between User and Testing are not correct";
          result[6].error = "Route entries between Testing and User are not correct";
        }
      }
    } else {
      result[4].error = "VPC Peering Name 'User-Testing' not available";
      result[5].error = "VPC Peering Name 'User-Testing' not available to validate Route entries between User and Testing";
      result[6].error = "VPC Peering Name 'User-Testing' not available to validate Route entries between Testing and User";
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    return result;
  }
}

async function getMainRouteTableId(vpcId) {
  try {
    const routeTablesData = await ec2.send(new DescribeRouteTablesCommand({ Filters: [{ Name: 'vpc-id', Values: [vpcId] }] }));
    const mainRouteTable = routeTablesData.RouteTables.find(rt => rt.Associations.some(assoc => assoc.Main));
    return mainRouteTable.RouteTableId;
  } catch (error) {
    console.error('Error getting main route table ID:', error);
    throw error;
  }
}

async function hasCIDRInRouteTable(routeTableId, cidrBlock) {
  try {
    const routeTableData = await ec2.send(new DescribeRouteTablesCommand({ RouteTableIds: [routeTableId] }));
    const route = routeTableData.RouteTables[0].Routes.find(route => route.DestinationCidrBlock === cidrBlock);
    return !!route;
  } catch (error) {
    console.error('Error checking CIDR in route table:', error);
    throw error;
  }
}

// Call the validation function asynchronously
(async () => {
  const validationResults = await validateConditions();
  console.log(validationResults);
  return validationResults;
})();
