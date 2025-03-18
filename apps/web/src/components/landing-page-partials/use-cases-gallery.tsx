import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AiOutlineAppstore } from 'react-icons/ai';
import { cn } from '@refly-packages/ai-workspace-common/utils/cn';
import { RiRobot2Fill, RiMarkdownLine, RiFile2Fill } from 'react-icons/ri';
import { Share2Icon, GitBranchIcon, LucideIcon } from 'lucide-react';
import { IconType } from 'react-icons';
import { Button, Card, Typography, Space } from 'antd';

const { Title, Paragraph } = Typography;

// Define TypeScript interfaces for our data structure
interface UseCase {
  id: string;
  title: string;
  description: string;
  category: string;
  coverImage: string;
  icon?: IconType | LucideIcon;
  color?: string;
}

interface Category {
  id: string;
  name: string;
}

const UseCasesGallery = () => {
  const { i18n } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<string>('featured');

  // Header configuration
  const header = {
    tag: 'Use Case Gallery',
    tagIcon: <AiOutlineAppstore />,
    title: 'Learn how Refly handles real-world tasks through step-by-step workflow on Canvas.',
    color: '#333333',
    tagShadow:
      '0 3px 20px 0 rgba(0,0,0,0.10), 0 2px 4px 0 rgba(0,0,0,0.10), inset 0 -4px 0 0 rgba(227,227,227,0.50)',
  };

  // Mock categories
  const categories: Category[] = [
    { id: 'featured', name: 'Featured' },
    { id: 'research', name: 'Research' },
    { id: 'life', name: 'Life' },
    { id: 'data', name: 'Data Analysis' },
    { id: 'education', name: 'Education' },
    { id: 'productivity', name: 'Productivity' },
    { id: 'wtf', name: 'WTF' },
  ];

  // Mock icons that will be randomly assigned to use cases
  const icons: (IconType | LucideIcon)[] = [
    RiRobot2Fill,
    RiMarkdownLine,
    RiFile2Fill,
    Share2Icon,
    GitBranchIcon,
  ];

  // Mock use cases data
  const useCases: UseCase[] = [
    {
      id: '1',
      title: 'Trip to Japan in April',
      description:
        'Refly integrates comprehensive travel information to create personalized itineraries and produces a custom travel handbook tailored specifically for your Japanese adventure.',
      category: 'featured',
      coverImage: 'https://static.refly.ai/share-cover/can-zxoztlncdztm6wtvc893dvkt.png',
      icon: icons[0],
      color: '#333333',
    },
    {
      id: '2',
      title: 'Deeply Analyze Tesla Stocks',
      description:
        "Refly delivers in-depth stock analysis with visually compelling dashboards that showcase comprehensive insights into Tesla's market performance and financial metrics.",
      category: 'featured',
      coverImage: 'https://static.refly.ai/share-cover/can-io39kq9tiaoey5tkm4gngbfj.png',
      icon: icons[1],
      color: '#333333',
    },
    {
      id: '3',
      title: 'Interactive Course on the Momentum Theorem',
      description:
        'Refly develops engaging video presentations for middle school educators, clearly explaining the momentum theorem through accessible and educational content.',
      category: 'education',
      coverImage: 'https://static.refly.ai/share-cover/can-nnz3d3ly5115zxyx5ufy0yj2.png',
      icon: icons[2],
      color: '#333333',
    },
    {
      id: '4',
      title: 'Comparative Analysis of Insurance Policies',
      description:
        'Looking to compare insurance options? Refly generates clear, structured comparison tables highlighting key policy information with optimal recommendations tailored to your needs.',
      category: 'featured',
      coverImage: 'https://static.refly.ai/share-cover/can-zxoztlncdztm6wtvc893dvkt.png',
      icon: icons[3],
      color: '#333333',
    },
    {
      id: '5',
      title: 'B2B Supplier Sourcing',
      description:
        'Refly conducts comprehensive research across extensive networks to identify the most suitable suppliers for your specific requirements. As your dedicated agent, Refly works exclusively in your best interest.',
      category: 'research',
      coverImage: 'https://static.refly.ai/share-cover/can-zxoztlncdztm6wtvc893dvkt.png',
      icon: icons[4],
      color: '#333333',
    },
    {
      id: '6',
      title: 'Research on AI Products for the Clothing Industry',
      description:
        'Refly conducted in-depth research on AI search products in the clothing industry with comprehensive product analysis and competitive positioning.',
      category: 'research',
      coverImage: 'https://static.refly.ai/share-cover/can-zxoztlncdztm6wtvc893dvkt.png',
      icon: icons[0],
      color: '#333333',
    },
    {
      id: '7',
      title: 'List of YC Companies',
      description:
        'Refly expertly navigated the YC W25 database to identify all qualifying B2B companies, meticulously compiling this valuable information into a structured table.',
      category: 'data',
      coverImage: 'https://static.refly.ai/share-cover/can-zxoztlncdztm6wtvc893dvkt.png',
      icon: icons[1],
      color: '#333333',
    },
    {
      id: '8',
      title: 'Online Store Operation Analysis',
      description:
        'Refly delivers actionable insights, detailed visualizations, and customized strategies designed to increase your sales performance from your Amazon store sales data.',
      category: 'data',
      coverImage: 'https://static.refly.ai/share-cover/can-zxoztlncdztm6wtvc893dvkt.png',
      icon: icons[2],
      color: '#333333',
    },
  ];

  // Prepare use cases data by category
  const getUseCasesByCategory = () => {
    // Create an object to store cases by category
    const casesByCategory: Record<string, UseCase[]> = {};

    // Group all use cases by their category
    for (const useCase of useCases) {
      if (!casesByCategory[useCase.category]) {
        casesByCategory[useCase.category] = [];
      }
      casesByCategory[useCase.category].push(useCase);
    }

    // For each category, limit to 4 items
    for (const category of Object.keys(casesByCategory)) {
      casesByCategory[category] = casesByCategory[category].slice(0, 4);
    }

    return casesByCategory;
  };

  // Create a cache of use cases by category
  const useCasesByCategory = getUseCasesByCategory();

  // Get filtered use cases based on active category
  const getFilteredUseCases = () => {
    if (activeCategory === 'featured') {
      // For featured, get 1 item from each category up to 4 total
      const featured: UseCase[] = [];

      // First add any explicitly featured items
      if (useCasesByCategory.featured) {
        featured.push(...useCasesByCategory.featured.slice(0, 4));
      }

      // If we still need more items, pull from other categories
      if (featured.length < 4) {
        for (const category of Object.keys(useCasesByCategory)) {
          if (
            category !== 'featured' &&
            featured.length < 4 &&
            useCasesByCategory[category].length > 0
          ) {
            featured.push(useCasesByCategory[category][0]);
          }
        }
      }

      return featured.slice(0, 4);
    }

    // For specific categories, return up to 4 items from that category
    return useCasesByCategory[activeCategory] || [];
  };

  // Get filtered use cases
  const filteredUseCases = getFilteredUseCases();

  return (
    <section className="relative mx-auto mt-[98px] max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
      {/* Header Section */}
      <div className="mb-16 text-center">
        <span
          className="mb-8 inline-flex items-center justify-center rounded-lg border border-solid border-black/10 bg-white px-6 py-2 font-['Alibaba_PuHuiTi_Bold',system-ui,-apple-system,sans-serif] text-sm"
          style={{
            color: header?.color ?? '#000000',
            boxShadow: header?.tagShadow ?? '0 3px 20px 0 rgba(0,0,0,0.10)',
          }}
        >
          {header?.tagIcon && (
            <span className="mr-2 flex items-center" style={{ color: header?.color ?? '#000000' }}>
              {typeof header.tagIcon === 'string' ? header.tagIcon : header.tagIcon}
            </span>
          )}
          <span>{header?.tag}</span>
        </span>
        <section className="text-center">
          <Title
            level={2}
            className="font-['Alibaba_PuHuiTi_Bold',system-ui,-apple-system,sans-serif]"
          >
            {i18n.language === 'zh-CN' ? (
              <div className="mt-2">
                <span className="relative text-[#333333]">
                  使用案例展示
                  <span className="absolute bottom-0 left-0 h-1 w-full bg-[#333333]" />
                </span>
              </div>
            ) : (
              <div className="mt-2">
                <span className="relative text-[#333333]">
                  Use case gallery
                  <span className="absolute bottom-0 left-0 h-1 w-full bg-[#333333]" />
                </span>
              </div>
            )}
          </Title>
          <Paragraph className="mx-auto mt-4 max-w-3xl text-center text-gray-500">
            {header.title}
          </Paragraph>
        </section>
      </div>

      {/* Category Tabs */}
      <Space wrap className="mb-10 flex justify-center">
        {categories.map((category) => (
          <Button
            key={category.id}
            type={activeCategory === category.id ? 'primary' : 'default'}
            onClick={() => setActiveCategory(category.id)}
            shape="round"
            className={cn(
              'transition-all duration-200',
              activeCategory === category.id && 'shadow-md',
            )}
            style={
              activeCategory === category.id
                ? { backgroundColor: '#333333', borderColor: '#333333' }
                : {}
            }
          >
            {category.name}
          </Button>
        ))}
      </Space>

      {/* Use Cases Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {filteredUseCases.map((useCase) => {
          const IconComponent = useCase.icon || icons[Math.floor(Math.random() * icons.length)];

          return (
            <Card
              key={useCase.id}
              className="group overflow-hidden transition-all duration-300 hover:shadow-md cursor-pointer"
              bodyStyle={{ padding: 0 }}
              cover={
                <div className="relative h-48 w-full overflow-hidden">
                  <img
                    src={useCase.coverImage}
                    alt={useCase.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
              }
            >
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: useCase.color }}
                    >
                      <IconComponent className="h-5 w-5" />
                    </div>
                  </div>
                </div>
                <div className="min-w-0 flex-1 mt-2">
                  <Title
                    level={4}
                    className="!mb-2 !mt-0 line-clamp-2"
                    style={{ color: useCase.color }}
                  >
                    {useCase.title}
                  </Title>
                  <Paragraph className="!mb-0 text-gray-600 line-clamp-3">
                    {useCase.description}
                  </Paragraph>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
};

export default UseCasesGallery;
